"""Erkennung von Gassirunden aus GPS-Positionen.

Eine Runde beginnt, wenn der Hund den Bereich um das Zuhause verlässt, und endet,
wenn er zurück ist oder längere Zeit an einem Ort bleibt (Pause). Autofahrten
werden herausgeschnitten, zu kurze Ausflüge verworfen.
Punkte: (ts, lat, lon, genauigkeit_m, ...)
"""
from __future__ import annotations

import math
from datetime import datetime

from .zeit import TZ

STANDARD = {
    "zuhause_lat": None,        # leer = automatisch (wo der Hund nachts ist)
    "zuhause_lon": None,
    "zuhause_radius_m": 80,
    "pause_min": 15,            # so lange an einem Ort = Runde endet dort
    "pause_radius_m": 60,
    "min_dauer_min": 5,         # kürzere Ausflüge werden ignoriert
    "min_strecke_m": 300,
    "max_ungenauigkeit_m": 75,  # ungenauere GPS-Punkte werden verworfen
    "luecke_max_min": 40,       # längere Datenlücke = Runde endet
    "auto_kmh": 15,             # schneller über längere Zeit = Autofahrt
    "auto_min_sek": 90,
}


def einstellungen(eigene: dict | None) -> dict:
    cfg = dict(STANDARD)
    for k, v in (eigene or {}).items():
        if k in STANDARD:
            cfg[k] = v
    return cfg


def abstand_m(lat1, lon1, lat2, lon2):
    """Entfernung zweier Koordinaten in Metern (Haversine)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371000.0 * math.asin(math.sqrt(a))


def finde_zuhause(punkte):
    """Schätzt das Zuhause: wo der Hund nachts (1-5 Uhr) meistens ist (Median)."""
    nachts = [p for p in punkte if 1 <= datetime.fromtimestamp(p[0], TZ).hour < 5]
    basis = nachts or punkte
    if not basis:
        return None
    lats = sorted(p[1] for p in basis)
    lons = sorted(p[2] for p in basis)
    return lats[len(lats) // 2], lons[len(lons) // 2]


def strecke_m(seg, min_schritt=15):
    """Gelaufene Strecke; kleine GPS-Zitterbewegungen werden ignoriert."""
    if not seg:
        return 0.0
    summe, ref = 0.0, seg[0]
    for p in seg[1:]:
        d = abstand_m(ref[1], ref[2], p[1], p[2])
        if d >= min_schritt:
            summe += d
            ref = p
    return summe


def teile_bei_autofahrt(seg, cfg):
    grenze = cfg["auto_kmh"] / 3.6
    teile, start, i, n = [], 0, 0, len(seg)
    while i < n - 1:
        j = i
        while j < n - 1:
            dt = seg[j + 1][0] - seg[j][0]
            if dt <= 0 or abstand_m(seg[j][1], seg[j][2], seg[j + 1][1], seg[j + 1][2]) / dt < grenze:
                break
            j += 1
        if j > i and seg[j][0] - seg[i][0] >= cfg["auto_min_sek"]:
            teile.append(seg[start:i + 1])
            start = i = j
        else:
            i = j + 1 if j > i else i + 1
    teile.append(seg[start:])
    return [t for t in teile if len(t) >= 2]


def teile_bei_pause(seg, cfg):
    radius, dauer = cfg["pause_radius_m"], cfg["pause_min"] * 60
    teile, start, i, n = [], 0, 0, len(seg)
    while i < n:
        j = i
        while j + 1 < n and abstand_m(seg[i][1], seg[i][2], seg[j + 1][1], seg[j + 1][2]) <= radius:
            j += 1
        if seg[j][0] - seg[i][0] >= dauer:
            teile.append(seg[start:i + 1])
            start = j
            i = j + 1
        else:
            i += 1
    teile.append(seg[start:])
    return [t for t in teile if len(t) >= 2]


def erkenne_runden(punkte, zuhause, cfg) -> list[dict]:
    radius = cfg["zuhause_radius_m"]
    luecke = cfg["luecke_max_min"] * 60
    gesehen, pts = set(), []
    for p in sorted(punkte, key=lambda x: x[0]):
        if p[0] in gesehen or (p[3] is not None and p[3] > cfg["max_ungenauigkeit_m"]):
            continue
        gesehen.add(p[0])
        pts.append(p)

    def draussen(p):
        return abstand_m(p[1], p[2], zuhause[0], zuhause[1]) > radius

    # 1) zusammenhängende Abschnitte außerhalb von Zuhause
    abschnitte, i, n = [], 0, len(pts)
    while i < n:
        if not draussen(pts[i]):
            i += 1
            continue
        seg = []
        if i > 0 and pts[i][0] - pts[i - 1][0] <= 300:   # letzter Punkt zu Hause = Start
            seg.append(pts[i - 1])
        while i < n and draussen(pts[i]):
            if seg and pts[i][0] - seg[-1][0] > luecke:
                break
            seg.append(pts[i])
            i += 1
        if i < n and not draussen(pts[i]) and pts[i][0] - seg[-1][0] <= luecke:   # zurück = Ende
            seg.append(pts[i])
        abschnitte.append(seg)

    # 2) bei Autofahrten und Pausen aufteilen, 3) zu kurze verwerfen
    runden = []
    for seg in abschnitte:
        teile = [r for teil in teile_bei_autofahrt(seg, cfg) for r in teile_bei_pause(teil, cfg)]
        for k, r in enumerate(teile):
            dauer, weg = r[-1][0] - r[0][0], strecke_m(r)
            if dauer < cfg["min_dauer_min"] * 60 or weg < cfg["min_strecke_m"]:
                continue
            runden.append({
                "start_ts": r[0][0], "ende_ts": r[-1][0], "dauer_s": dauer, "strecke_m": round(weg),
                "max_entfernung_m": round(max(abstand_m(p[1], p[2], zuhause[0], zuhause[1]) for p in r)),
                "start_zuhause": k == 0,
                "ende_zuhause": k == len(teile) - 1 and not draussen(r[-1]),
                "punkte": [[round(p[1], 6), round(p[2], 6), p[0]] for p in r],
            })
    return runden
