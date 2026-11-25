#!/usr/bin/env python3
"""
Gassi-Runden: holt den Positionsverlauf des Hundes von Tractive,
erkennt einzelne Runden und erzeugt eine Auswertung als HTML-Seite.

Aufruf:
    python gassi.py            -> Daten laden, Runden erkennen, Bericht erzeugen
    python gassi.py --demo     -> Bericht mit erfundenen Beispieldaten (ohne Login)
    python gassi.py --tage 60  -> die letzten 60 Tage laden

Hinweis: Tractive bietet keine offizielle Schnittstelle an. Dieses Skript
nutzt dieselbe Schnittstelle wie die Tractive-App. Wenn Tractive sie
ändert, muss das Skript evtl. angepasst werden.
"""
import argparse
import getpass
import json
import math
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import date, datetime, timedelta
from pathlib import Path

BASIS = Path(__file__).resolve().parent
DATEN = BASIS / "daten"
CACHE = DATEN / "positionen"
TOKEN_DATEI = DATEN / "token.json"
CONFIG_DATEI = BASIS / "config.json"
VORLAGE = BASIS / "bericht_vorlage.html"
BERICHT = BASIS / "gassi_bericht.html"

API = "https://graph.tractive.com/4/"
APS_API = "https://aps-api.tractive.com/api/1/"   # Gesundheits-/Aktivitätsdaten
AKTIV_CACHE = DATEN / "aktivitaet"
CLIENT_ID = "625e533dc3c3b41c28a669f0"  # Client-Kennung der Tractive-Web-App

STANDARD = {
    "email": "",
    "tracker_id": "",          # leer = erster Tracker im Konto
    "hundename": "",           # leer = Name aus Tractive
    "zuhause": {"lat": None, "lon": None, "radius_m": 80},
    "tage_laden": 30,
    "pause_min": 15,           # so lange an einem Ort = Runde endet dort
    "pause_radius_m": 60,      # "an einem Ort" = innerhalb dieses Radius
    "min_dauer_min": 5,        # kürzere Ausflüge werden ignoriert
    "min_strecke_m": 300,      # kürzere Ausflüge werden ignoriert
    "max_ungenauigkeit_m": 75, # ungenauere GPS-Punkte werden verworfen
    "luecke_max_min": 40,      # längere Datenlücke = Runde endet
    "auto_kmh": 15,            # schneller über längere Zeit = Autofahrt, keine Runde
    "auto_min_sek": 90,
    "runden_mit_aktivitaet": False,  # true = Rundenzeiten an Aktivitätsdaten ausrichten
    "aktiv_max_vorlauf_min": 30,   # Runde darf per Aktivität so viel früher beginnen
    "aktiv_max_nachlauf_min": 30,  # ... und so viel später enden als laut GPS
}


# --------------------------------------------------------------------------
# Hilfsfunktionen
# --------------------------------------------------------------------------
def abstand_m(lat1, lon1, lat2, lon2):
    """Entfernung zweier Koordinaten in Metern (Haversine)."""
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def lade_env():
    """Liest Zugangsdaten aus der Datei .env (Format: NAME=wert) in die Umgebung."""
    datei = BASIS / ".env"
    if not datei.exists():
        return
    for zeile in datei.read_text(encoding="utf-8").splitlines():
        zeile = zeile.strip()
        if not zeile or zeile.startswith("#") or "=" not in zeile:
            continue
        name, wert = zeile.split("=", 1)
        wert = wert.strip().strip('"').strip("'")
        if wert and not os.environ.get(name.strip()):
            os.environ[name.strip()] = wert


def lade_config():
    lade_env()
    cfg = json.loads(json.dumps(STANDARD))
    if CONFIG_DATEI.exists():
        eigene = json.loads(CONFIG_DATEI.read_text(encoding="utf-8"))
        for k, v in eigene.items():
            if k == "zuhause" and isinstance(v, dict):
                cfg["zuhause"].update(v)
            else:
                cfg[k] = v
    if os.environ.get("TRACTIVE_EMAIL"):
        cfg["email"] = os.environ["TRACTIVE_EMAIL"]
    return cfg


# --------------------------------------------------------------------------
# Tractive-Schnittstelle
# --------------------------------------------------------------------------
class Tractive:
    def __init__(self, email):
        self.email = email
        self.token = None
        self.user_id = None

    def _anfrage(self, methode, pfad, body=None, params=None, auth=True, basis=None):
        url = (basis or API) + pfad
        if params:
            url += "?" + urllib.parse.urlencode(params)
        headers = {
            "X-Tractive-Client": CLIENT_ID,
            "Content-Type": "application/json;charset=UTF-8",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0",
        }
        if auth:
            headers["Authorization"] = f"Bearer {self.token}"
            headers["X-Tractive-User"] = self.user_id
        daten = json.dumps(body).encode() if body is not None else None
        wartezeiten = [20, 45, 90, 180]
        for versuch in range(len(wartezeiten) + 1):
            req = urllib.request.Request(url, data=daten, headers=headers, method=methode)
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    text = r.read().decode("utf-8")
                    return json.loads(text) if text else None
            except urllib.error.HTTPError as e:
                inhalt = e.read().decode("utf-8", "replace")[:300]
                if e.code == 429 and versuch < len(wartezeiten):
                    w = wartezeiten[versuch]
                    print(f" (Tractive bremst, warte {w} s)", end="", flush=True)
                    time.sleep(w)
                    continue
                raise RuntimeError(f"Tractive antwortet mit Fehler {e.code} bei {pfad}: {inhalt}") from None

    def anmelden(self):
        DATEN.mkdir(parents=True, exist_ok=True)
        if TOKEN_DATEI.exists():
            t = json.loads(TOKEN_DATEI.read_text(encoding="utf-8"))
            if t.get("email") == self.email and t.get("expires_at", 0) > datetime.now().timestamp() + 300:
                self.token, self.user_id = t["access_token"], t["user_id"]
                return
        passwort = os.environ.get("TRACTIVE_PASSWORT")
        if not passwort:
            if not sys.stdin or not sys.stdin.isatty():
                raise RuntimeError("Tractive-Login abgelaufen. Bitte gassi.py einmal von Hand starten "
                                   "und das Passwort eingeben (oder TRACTIVE_PASSWORT in .env setzen).")
            passwort = getpass.getpass(f"Tractive-Passwort für {self.email} (wird nicht gespeichert): ")
        antwort = self._anfrage("POST", "auth/token", body={
            "platform_email": self.email,
            "platform_token": passwort,
            "grant_type": "tractive",
        }, auth=False)
        self.token, self.user_id = antwort["access_token"], antwort["user_id"]
        TOKEN_DATEI.write_text(json.dumps({
            "email": self.email,
            "access_token": self.token,
            "user_id": self.user_id,
            "expires_at": antwort.get("expires_at", 0),
        }), encoding="utf-8")

    def tracker(self):
        return [t["_id"] for t in self._anfrage("GET", f"user/{self.user_id}/trackers")]

    def haustier(self, tracker_id):
        """(Haustier-ID, Name) des Tiers, das den Tracker trägt."""
        try:
            for obj in self._anfrage("GET", f"user/{self.user_id}/trackable_objects"):
                d = self._anfrage("GET", f"trackable_object/{obj['_id']}")
                if d.get("device_id") == tracker_id:
                    return obj["_id"], d.get("details", {}).get("name", "")
        except Exception:
            pass
        return None, ""

    def aktivitaet_heute(self, haustier_id):
        """Aktivitätsverlauf (Schlaf/Ruhe/Aktiv) von heute. Tractive liefert nur den
        aktuellen Tag, deshalb wird er bei jedem Lauf lokal gespeichert."""
        r = self._anfrage("GET", f"pet/{haustier_id}/health/overview", basis=APS_API)
        t0 = datetime.combine(date.today(), datetime.min.time()).timestamp()
        segmente = [[int(t0 + s["startOffsetSeconds"]),
                     int(t0 + s["startOffsetSeconds"] + s["durationSeconds"]), s["state"]]
                    for s in (r.get("stateTimeline") or {}).get("segments", [])]
        return {
            "minuten_aktiv": (r.get("activity") or {}).get("minutesActive"),
            "stand": int(datetime.now().timestamp()),
            "segmente": segmente,
        }

    def positionen(self, tracker_id, von_ts, bis_ts):
        segmente = self._anfrage("GET", f"tracker/{tracker_id}/positions", params={
            "time_from": int(von_ts), "time_to": int(bis_ts), "format": "json_segments",
        }) or []
        punkte = []
        for seg in segmente:
            for p in seg:
                ll = p.get("latlong") or [None, None]
                if ll[0] is None:
                    continue
                punkte.append([p["time"], ll[0], ll[1], p.get("pos_uncertainty"), p.get("sensor_used")])
        return punkte


def verbinden(cfg):
    """Anmelden und Tracker/Haustier bestimmen."""
    if not cfg["email"]:
        sys.exit("Bitte zuerst deine Tractive-E-Mail in der Datei .env eintragen (siehe ANLEITUNG.md).")
    api = Tractive(cfg["email"])
    api.anmelden()
    tracker_id = cfg["tracker_id"]
    if not tracker_id:
        liste = api.tracker()
        if not liste:
            sys.exit("In deinem Tractive-Konto wurde kein Tracker gefunden.")
        tracker_id = liste[0]
        if len(liste) > 1:
            print(f"Mehrere Tracker gefunden: {', '.join(liste)} - nutze {tracker_id}. "
                  f"Anderen Tracker per 'tracker_id' in config.json wählen.")
    haustier_id, tractive_name = api.haustier(tracker_id)
    name = cfg["hundename"] or tractive_name or "Hund"
    return api, tracker_id, haustier_id, name


def speichere_aktivitaet(api, tracker_id, haustier_id):
    """Aktivitätsverlauf von heute abrufen und unter daten/aktivitaet/ ablegen."""
    ordner = AKTIV_CACHE / tracker_id
    ordner.mkdir(parents=True, exist_ok=True)
    a = api.aktivitaet_heute(haustier_id)
    (ordner / f"{date.today().isoformat()}.json").write_text(json.dumps(a), encoding="utf-8")
    return a


def nur_aktivitaet(cfg):
    """Für den nächtlichen Lauf (Aufgabenplanung): nur Aktivität speichern, Ergebnis protokollieren."""
    DATEN.mkdir(parents=True, exist_ok=True)
    zeit = datetime.now().strftime("%Y-%m-%d %H:%M")
    try:
        api, tracker_id, haustier_id, _ = verbinden(cfg)
        a = speichere_aktivitaet(api, tracker_id, haustier_id)
        meldung = f"{zeit} OK: {a['minuten_aktiv']} min aktiv, {len(a['segmente'])} Abschnitte gespeichert"
        code = 0
    except BaseException as e:  # auch sys.exit abfangen, damit es im Protokoll landet
        meldung = f"{zeit} FEHLER: {e}"
        code = 1
    print(meldung)
    with open(DATEN / "protokoll.txt", "a", encoding="utf-8") as f:
        f.write(meldung + "\n")
    return code


def lade_positionen(cfg, tage):
    """Lädt Positionen tageweise; vergangene Tage werden lokal zwischengespeichert."""
    api, tracker_id, haustier_id, name = verbinden(cfg)

    ordner = CACHE / tracker_id
    ordner.mkdir(parents=True, exist_ok=True)
    heute = date.today()
    alle_tage = [heute - timedelta(days=i) for i in range(tage, -1, -1)]
    datei = lambda t: ordner / f"{t.isoformat()}.json"
    fehlend = [t for t in alle_tage if t == heute or not datei(t).exists()]

    # fehlende Tage in Blöcken von bis zu 7 Tagen laden (weniger Abfragen)
    bloecke, block = [], []
    for t in fehlend:
        if block and ((t - block[-1]).days != 1 or len(block) >= 7):
            bloecke.append(block)
            block = []
        block.append(t)
    if block:
        bloecke.append(block)

    for nr, block in enumerate(bloecke):
        if nr:
            time.sleep(2)
        von = datetime.combine(block[0], datetime.min.time())
        bis = datetime.combine(block[-1], datetime.min.time()) + timedelta(days=1)
        print(f"  lade {block[0].isoformat()} bis {block[-1].isoformat()} ...", end="", flush=True)
        punkte = api.positionen(tracker_id, von.timestamp(), bis.timestamp())
        print(f" {len(punkte)} Punkte")
        pro_tag = {t: [] for t in block}
        for p in punkte:
            t = datetime.fromtimestamp(p[0]).date()
            if t in pro_tag:
                pro_tag[t].append(p)
        for t, liste in pro_tag.items():
            datei(t).write_text(json.dumps(liste), encoding="utf-8")

    alle = []
    for t in alle_tage:
        if datei(t).exists():
            alle += json.loads(datei(t).read_text(encoding="utf-8"))

    # Aktivität von heute holen und speichern (der Lauf um 23:55 überschreibt
    # sie später mit dem vollständigen Tag); frühere Tage aus dem Speicher
    if haustier_id:
        try:
            a = speichere_aktivitaet(api, tracker_id, haustier_id)
            print(f"  Aktivität heute bisher: {a['minuten_aktiv']} min aktiv")
        except Exception as e:
            print(f"  Aktivitätsdaten nicht verfügbar ({e}).")
    aktiv = {}
    for t in alle_tage:
        f = AKTIV_CACHE / tracker_id / f"{t.isoformat()}.json"
        if f.exists():
            aktiv[t.isoformat()] = json.loads(f.read_text(encoding="utf-8"))

    # letzte bekannte Position und Akku
    position = None
    try:
        p = api._anfrage("GET", f"device_pos_report/{tracker_id}")
        hw = api._anfrage("GET", f"device_hw_report/{tracker_id}")
        position = {"lat": p["latlong"][0], "lon": p["latlong"][1], "zeit": p["time"],
                    "genauigkeit_m": p.get("pos_uncertainty"), "quelle": p.get("sensor_used"),
                    "akku": hw.get("battery_level")}
    except Exception as e:
        print(f"  Aktuelle Position nicht verfügbar ({e}).")
    return name, alle, aktiv, position


# --------------------------------------------------------------------------
# Runden-Erkennung
# --------------------------------------------------------------------------
def finde_zuhause(punkte):
    """Schätzt das Zuhause: wo der Hund nachts (1-5 Uhr) meistens ist."""
    nachts = [p for p in punkte if 1 <= datetime.fromtimestamp(p[0]).hour < 5]
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
    """Schneidet Abschnitte heraus, in denen der Hund im Auto saß."""
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
            start = j
            i = j
        else:
            i = j + 1 if j > i else i + 1
    teile.append(seg[start:])
    return [t for t in teile if len(t) >= 2]


def teile_bei_pause(seg, cfg):
    """Längeres Verweilen an einem Ort beendet die Runde."""
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


def erkenne_runden(punkte, zuhause, cfg):
    radius = cfg["zuhause"]["radius_m"]
    luecke = cfg["luecke_max_min"] * 60
    # sortieren, doppelte Zeitstempel und ungenaue Punkte entfernen
    gesehen, pts = set(), []
    for p in sorted(punkte, key=lambda x: x[0]):
        if p[0] in gesehen:
            continue
        if p[3] is not None and p[3] > cfg["max_ungenauigkeit_m"]:
            continue
        gesehen.add(p[0])
        pts.append(p)

    def draussen(p):
        return abstand_m(p[1], p[2], zuhause[0], zuhause[1]) > radius

    # 1) zusammenhängende Abschnitte außerhalb von Zuhause finden
    abschnitte, i, n = [], 0, len(pts)
    while i < n:
        if not draussen(pts[i]):
            i += 1
            continue
        seg = []
        # letzter Punkt zu Hause kurz vor dem Losgehen = Startzeitpunkt
        if i > 0 and pts[i][0] - pts[i - 1][0] <= 300:
            seg.append(pts[i - 1])
        while i < n and draussen(pts[i]):
            if seg and pts[i][0] - seg[-1][0] > luecke:
                break
            seg.append(pts[i])
            i += 1
        # erster Punkt wieder zu Hause = Endzeitpunkt
        if i < n and not draussen(pts[i]) and pts[i][0] - seg[-1][0] <= luecke:
            seg.append(pts[i])
        abschnitte.append(seg)

    # 2) bei Autofahrten und langen Pausen aufteilen, 3) zu kurze verwerfen
    runden = []
    for seg in abschnitte:
        teile = [r for teil in teile_bei_autofahrt(seg, cfg) for r in teile_bei_pause(teil, cfg)]
        for k, r in enumerate(teile):
                dauer = r[-1][0] - r[0][0]
                weg = strecke_m(r)
                if dauer < cfg["min_dauer_min"] * 60 or weg < cfg["min_strecke_m"]:
                    continue
                runden.append({
                    "start": r[0][0],
                    "ende": r[-1][0],
                    "dauer_s": dauer,
                    "strecke_m": round(weg),
                    "max_entfernung_m": round(max(
                        abstand_m(p[1], p[2], zuhause[0], zuhause[1]) for p in r)),
                    # erster Teil eines Ausflugs beginnt zu Hause (auch wenn der
                    # Tracker zu Hause selten sendet), spätere Teile nach einer Pause
                    "start_zuhause": k == 0,
                    "ende_zuhause": k == len(teile) - 1 and not draussen(r[-1]),
                    "punkte": [[round(p[1], 6), round(p[2], 6), p[0]] for p in r],
                })
    return runden


def verfeinere_mit_aktivitaet(runden, aktiv, cfg):
    """Start und Ende einer Runde an Tractives Aktivitätsverlauf ausrichten.

    GPS erfasst Anfang und Ende oft nicht: Zu Hause sendet der Tracker kaum,
    und kurz vor dem Haus sieht GPS aus wie "zu Hause". Der Bewegungssensor
    weiß dagegen minutengenau, wann der Hund aktiv war."""
    roh = sorted(s for tag in aktiv.values() for s in tag.get("segmente", []) if "ACTIVE" in s[2])
    segs = []
    for a, b, _ in roh:  # aktive Abschnitte mit sehr kurzer Unterbrechung zusammenfassen
        if segs and a - segs[-1][1] <= 5 * 60:
            segs[-1][1] = max(segs[-1][1], b)
        else:
            segs.append([a, b])
    if not segs:
        return runden
    vor, nach, tol = cfg["aktiv_max_vorlauf_min"] * 60, cfg["aktiv_max_nachlauf_min"] * 60, 5 * 60
    runden.sort(key=lambda r: r["start"])
    for i, r in enumerate(runden):
        frueheste = runden[i - 1]["ende"] if i else 0
        spaeteste = runden[i + 1]["start"] if i + 1 < len(runden) else float("inf")
        start, ende = r["start"], r["ende"]
        if r["start_zuhause"]:
            for a, b in segs:
                if a <= start + tol and b >= start - tol and start - vor <= a:
                    start = max(a, frueheste)
                    break
        if r["ende_zuhause"]:
            for a, b in segs:
                if a <= ende + tol and b >= ende - tol and b <= ende + nach:
                    ende = min(b, spaeteste)
        if (start, ende) != (r["start"], r["ende"]) and ende > start:
            r["start"], r["ende"], r["dauer_s"] = start, ende, ende - start
            r["zeit_aus_aktivitaet"] = True
    return runden


# --------------------------------------------------------------------------
# Bericht
# --------------------------------------------------------------------------
def schreibe_bericht(name, runden, zuhause, cfg, aktiv=None, position=None):
    daten = {
        "aktivitaet": aktiv or {},
        "position": position,
        "hund": name,
        "erstellt": int(datetime.now().timestamp()),
        "zuhause": {"lat": zuhause[0], "lon": zuhause[1], "radius_m": cfg["zuhause"]["radius_m"]},
        "karte": {
            "key": os.environ.get("MAPTILER_KEY", ""),
            "stil": os.environ.get("MAPTILER_STIL", "streets-v2"),
        },
        "runden": runden,
    }
    json_text = json.dumps(daten, ensure_ascii=False).replace("</", "<\\/")
    html = VORLAGE.read_text(encoding="utf-8").replace("/*__DATEN__*/null", json_text)
    BERICHT.write_text(html, encoding="utf-8")
    return BERICHT


# --------------------------------------------------------------------------
# Demo-Daten (erfunden, zum Ausprobieren ohne Tractive-Login)
# --------------------------------------------------------------------------
def demo_punkte(tage=21):
    random.seed(7)
    home = (48.1500, 11.5900)
    punkte = []

    def jitter(lat, lon, m=6):
        return lat + random.gauss(0, m) / 111000, lon + random.gauss(0, m) / 74000

    def schleife(t, start, km, minuten, richtung):
        """Rundweg: raus, Bogen, zurück. Punkt alle ~20 s."""
        schritte = int(minuten * 3)
        radius = km * 1000 / (2 * math.pi)
        cx = start[0] + math.cos(richtung) * radius / 111000
        cy = start[1] + math.sin(richtung) * radius / 74000
        out = []
        for s in range(schritte + 1):
            w = richtung + math.pi + 2 * math.pi * s / schritte
            lat = cx + math.cos(w) * radius / 111000
            lon = cy + math.sin(w) * radius / 74000
            out.append([t + s * 20, *jitter(lat, lon), random.choice([5, 8, 12, 20])])
        return out

    heute = date.today()
    for i in range(tage, -1, -1):
        tag = heute - timedelta(days=i)
        t0 = datetime.combine(tag, datetime.min.time()).timestamp()
        bloecke = [(7.0 + random.random() * 0.8, random.uniform(1.5, 3.2), random.uniform(25, 45)),
                   (12.5 + random.random(), random.uniform(0.6, 1.2), random.uniform(10, 20)),
                   (18.0 + random.random() * 1.5, random.uniform(2.5, 5.5), random.uniform(40, 75))]
        if random.random() < 0.25:
            bloecke.pop(1)
        t = t0
        for (std, km, minuten) in bloecke:
            beginn = t0 + std * 3600
            while t < beginn:  # zu Hause: alle 10 min ein Punkt
                punkte.append([int(t), *jitter(*home, 10), 15])
                t += 600
            runde = schleife(int(beginn), home, km, minuten, random.uniform(0, 2 * math.pi))
            if i % 4 == 1 and std > 17:
                # Runde mit langer Einkehr (Biergarten) in der Mitte
                mitte = len(runde) // 2
                pause_t = runde[mitte][0]
                ort = runde[mitte][1:3]
                pause = [[pause_t + k * 120, *jitter(*ort, 8), 10] for k in range(1, 16)]
                versatz = 15 * 120
                runde = runde[:mitte + 1] + pause + [[p[0] + versatz, *p[1:]] for p in runde[mitte + 1:]]
            punkte += [[int(p[0]), p[1], p[2], p[3]] for p in runde]
            t = runde[-1][0] + 60
        while t < t0 + 86400 and t < datetime.now().timestamp():
            punkte.append([int(t), *jitter(*home, 10), 15])
            t += 600
    jetzt = datetime.now().timestamp()
    return "Bello (Demo)", [p for p in punkte if p[0] <= jetzt], home


# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Gassi-Runden aus Tractive-Daten auswerten")
    ap.add_argument("--demo", action="store_true", help="erfundene Beispieldaten statt Tractive")
    ap.add_argument("--tage", type=int, help="wie viele Tage zurück laden")
    ap.add_argument("--nicht-oeffnen", action="store_true", help="Bericht nicht im Browser öffnen")
    ap.add_argument("--nur-aktivitaet", action="store_true",
                    help="nur den Aktivitätsverlauf von heute speichern (für den Lauf um 23:55)")
    args = ap.parse_args()
    cfg = lade_config()

    if args.nur_aktivitaet:
        sys.exit(nur_aktivitaet(cfg))

    aktiv, position = {}, None
    if args.demo:
        name, punkte, zuhause = demo_punkte()
    else:
        tage = args.tage or cfg["tage_laden"]
        print(f"Lade Tractive-Daten der letzten {tage} Tage ...")
        name, punkte, aktiv, position = lade_positionen(cfg, tage)
        z = cfg["zuhause"]
        if z.get("lat") is not None and z.get("lon") is not None:
            zuhause = (z["lat"], z["lon"])
        else:
            zuhause = finde_zuhause(punkte)
            if not zuhause:
                sys.exit("Keine Positionsdaten gefunden.")
            print(f"Zuhause automatisch erkannt bei {zuhause[0]:.5f}, {zuhause[1]:.5f} "
                  f"(kann in config.json unter 'zuhause' fest eingetragen werden).")

    runden = erkenne_runden(punkte, zuhause, cfg)
    if cfg["runden_mit_aktivitaet"]:
        runden = verfeinere_mit_aktivitaet(runden, aktiv, cfg)
    print(f"{len(punkte)} Positionen, {len(runden)} Runden erkannt, "
          f"Aktivitätsdaten für {len(aktiv)} Tage.")
    pfad = schreibe_bericht(name, runden, zuhause, cfg, aktiv, position)
    print(f"Bericht: {pfad}")
    if not args.nicht_oeffnen:
        webbrowser.open(pfad.as_uri())


if __name__ == "__main__":
    main()
