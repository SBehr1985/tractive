"""Daten eines Hundes: Runden, Aktivität, Position, Einstellungen."""
from __future__ import annotations

import os
import threading
import time

from fastapi import APIRouter, Depends, HTTPException, status

from core import runden, sync
from core.storage import Jsonb

from .deps import get_current_user, get_db, hund_pruefen

router = APIRouter(prefix="/api", tags=["daten"])

_position_cache: dict[str, tuple[float, dict]] = {}
POSITION_CACHE_S = 60


@router.get("/config")
def config():
    return {"maptiler_key": os.environ.get("MAPTILER_KEY", ""),
            "maptiler_stil": os.environ.get("MAPTILER_STIL", "streets-v2")}


def _uebersicht(conn, tracker_id: str) -> dict:
    t = conn.execute("SELECT * FROM trackers WHERE id = %s", (tracker_id,)).fetchone()
    cfg = runden.einstellungen(t["einstellungen"])
    if cfg["zuhause_lat"] is not None and cfg["zuhause_lon"] is not None:
        zuhause = {"lat": float(cfg["zuhause_lat"]), "lon": float(cfg["zuhause_lon"]), "auto": False}
    elif t["zuhause_auto"]:
        zuhause = {**t["zuhause_auto"], "auto": True}
    else:
        zuhause = None
    if zuhause:
        zuhause["radius_m"] = cfg["zuhause_radius_m"]
    return {
        "id": t["id"], "name": t["name"], "zuhause": zuhause, "akku": t["akku"],
        "letzte_position": t["letzte_position"], "einstellungen": cfg,
        "letzter_sync": t["letzter_sync"].isoformat() if t["letzter_sync"] else None,
        "sync_fehler": t["sync_fehler"],
        "laedt": t["letzter_sync"] is None,
    }


@router.get("/hunde/{tracker_id}")
def uebersicht(tracker_id: str, user=Depends(get_current_user), conn=Depends(get_db)):
    hund_pruefen(conn, user, tracker_id)
    return _uebersicht(conn, tracker_id)


@router.get("/hunde/{tracker_id}/runden")
def runden_liste(tracker_id: str, von: int | None = None, bis: int | None = None, punkte: bool = False,
                 user=Depends(get_current_user), conn=Depends(get_db)):
    """Alle Runden (neueste zuerst). Mit von/bis (Unix-Sekunden, Start der Runde) nur dieser Zeitraum,
    mit punkte=true inklusive Strecke (für die Tageskarte)."""
    hund_pruefen(conn, user, tracker_id)
    felder = "start_ts AS start, ende_ts AS ende, dauer_s, strecke_m, max_entfernung_m, start_zuhause, ende_zuhause"
    if punkte:
        felder += ", punkte"
    return conn.execute(
        f"SELECT {felder} FROM walks WHERE tracker_id = %s AND start_ts >= %s AND start_ts < %s ORDER BY start_ts DESC",
        (tracker_id, von or 0, bis or 2**62)).fetchall()


@router.get("/hunde/{tracker_id}/runden/{start_ts}")
def runde(tracker_id: str, start_ts: int, user=Depends(get_current_user), conn=Depends(get_db)):
    hund_pruefen(conn, user, tracker_id)
    r = conn.execute(
        "SELECT start_ts AS start, ende_ts AS ende, dauer_s, strecke_m, max_entfernung_m, start_zuhause, "
        "ende_zuhause, punkte FROM walks WHERE tracker_id = %s AND start_ts = %s", (tracker_id, start_ts)).fetchone()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Runde nicht gefunden.")
    return r


@router.get("/hunde/{tracker_id}/aktivitaet")
def aktivitaet(tracker_id: str, user=Depends(get_current_user), conn=Depends(get_db)):
    hund_pruefen(conn, user, tracker_id)
    rows = conn.execute(
        "SELECT tag, minuten_aktiv, segmente, abgerufen_at, vollstaendig FROM activity_days "
        "WHERE tracker_id = %s ORDER BY tag DESC", (tracker_id,)).fetchall()
    return [{**r, "tag": r["tag"].isoformat(), "abgerufen_at": int(r["abgerufen_at"].timestamp())} for r in rows]


@router.get("/hunde/{tracker_id}/position")
def position(tracker_id: str, user=Depends(get_current_user), conn=Depends(get_db)):
    """Aktuelle Position direkt von Tractive (höchstens einmal pro Minute abgefragt)."""
    hund_pruefen(conn, user, tracker_id)
    cache = _position_cache.get(tracker_id)
    if cache and time.time() - cache[0] < POSITION_CACHE_S:
        return cache[1]
    try:
        pos = sync.mit_tracker_client(conn, tracker_id, lambda c: sync.position_laden(conn, tracker_id, c))
    except Exception as e:
        t = conn.execute("SELECT letzte_position FROM trackers WHERE id = %s", (tracker_id,)).fetchone()
        if t and t["letzte_position"]:
            return {**t["letzte_position"], "veraltet": True, "fehler": str(e)[:200]}
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Position nicht abrufbar: {e}") from None
    _position_cache[tracker_id] = (time.time(), pos)
    return pos


ZAHL_FELDER = {k for k in runden.STANDARD}


@router.put("/hunde/{tracker_id}/einstellungen")
def einstellungen_speichern(tracker_id: str, body: dict, user=Depends(get_current_user), conn=Depends(get_db)):
    hund_pruefen(conn, user, tracker_id)
    neu = {}
    for k, v in body.items():
        if k not in ZAHL_FELDER:
            continue
        if v is None or v == "":
            neu[k] = None if k in ("zuhause_lat", "zuhause_lon") else runden.STANDARD[k]
            continue
        try:
            neu[k] = float(v)
        except (TypeError, ValueError):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Ungültiger Wert für {k}.") from None
    if (neu.get("zuhause_lat") is None) != (neu.get("zuhause_lon") is None):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Zuhause braucht Breite und Länge (oder beides leer).")
    conn.execute("UPDATE trackers SET einstellungen = %s WHERE id = %s", (Jsonb(neu), tracker_id))
    conn.commit()
    sync.runden_berechnen(conn, tracker_id)
    return _uebersicht(conn, tracker_id)


@router.post("/hunde/{tracker_id}/abgleichen")
def abgleichen(tracker_id: str, user=Depends(get_current_user), conn=Depends(get_db)):
    """Daten jetzt von Tractive holen (läuft im Hintergrund)."""
    hund_pruefen(conn, user, tracker_id)
    t = conn.execute("SELECT EXTRACT(EPOCH FROM now() - letzter_sync) AS alter FROM trackers WHERE id = %s",
                     (tracker_id,)).fetchone()
    if t["alter"] is not None and t["alter"] < 60:
        return {"gestartet": False, "grund": "Gerade erst aktualisiert."}
    threading.Thread(target=sync.tracker_abgleichen, args=(tracker_id,), daemon=True).start()
    return {"gestartet": True}
