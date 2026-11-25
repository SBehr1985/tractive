"""Daten von Tractive holen und in der Datenbank ablegen.

Für jeden Tracker wird das Token eines verknüpften Benutzers verwendet. Lehnt
Tractive ein Token ab, wird es als ungültig markiert und das nächste probiert;
der Benutzer muss sich dann neu anmelden.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime

from . import geheim, runden, storage
from .storage import Jsonb
from .tractive import Client, TractiveFehler
from .zeit import TZ

log = logging.getLogger("sync")

BACKFILL_TAGE = 30
BLOCK_TAGE = 7
_sperren: dict[str, threading.Lock] = {}
_sperren_lock = threading.Lock()


def _sperre(tracker_id: str) -> threading.Lock:
    with _sperren_lock:
        return _sperren.setdefault(tracker_id, threading.Lock())


# ---------------------------------------------------------------------------
# Benutzer / Tokens
# ---------------------------------------------------------------------------
def clients_fuer_tracker(conn, tracker_id: str):
    """Alle gültigen Tractive-Zugänge, die diesen Tracker sehen dürfen (zuletzt angemeldet zuerst)."""
    rows = conn.execute(
        "SELECT u.id, u.tractive_user_id, u.token_enc FROM users u "
        "JOIN user_trackers ut ON ut.user_id = u.id "
        "WHERE ut.tracker_id = %s AND u.token_ok AND u.token_enc IS NOT NULL "
        "AND COALESCE(u.token_expires_at, 0) > %s ORDER BY u.last_login_at DESC NULLS LAST",
        (tracker_id, int(time.time()) + 300),
    ).fetchall()
    for r in rows:
        try:
            yield r["id"], Client(r["tractive_user_id"], geheim.entschluesseln(r["token_enc"]))
        except Exception:
            log.warning("Token von Benutzer %s nicht lesbar", r["id"])


def mit_tracker_client(conn, tracker_id: str, aufgabe):
    """Führt aufgabe(client) mit dem ersten funktionierenden Token aus."""
    letzter = None
    for user_id, client in clients_fuer_tracker(conn, tracker_id):
        try:
            return aufgabe(client)
        except TractiveFehler as e:
            if e.status in (401, 403):
                conn.execute("UPDATE users SET token_ok = FALSE WHERE id = %s", (user_id,))
                conn.commit()
                letzter = e
                continue
            raise
    raise RuntimeError("Kein gültiger Tractive-Zugang für diesen Hund – bitte neu anmelden.") from letzter


def hunde_des_benutzers_aktualisieren(conn, user_id: int, client: Client) -> list[str]:
    """Gleicht die Hunde des Tractive-Kontos ab. Gibt die Tracker-IDs zurück."""
    hunde = client.hunde()
    for h in hunde:
        conn.execute(
            "INSERT INTO trackers (id, pet_id, name) VALUES (%s, %s, %s) "
            "ON CONFLICT (id) DO UPDATE SET pet_id = EXCLUDED.pet_id, name = EXCLUDED.name",
            (h["tracker_id"], h["pet_id"], h["name"]),
        )
    conn.execute("DELETE FROM user_trackers WHERE user_id = %s", (user_id,))
    for h in hunde:
        conn.execute("INSERT INTO user_trackers (user_id, tracker_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                     (user_id, h["tracker_id"]))
    conn.commit()
    return [h["tracker_id"] for h in hunde]


# ---------------------------------------------------------------------------
# Einzelschritte
# ---------------------------------------------------------------------------
def positionen_laden(conn, tracker_id: str, client: Client) -> int:
    """Lädt neue Positionen (beim ersten Mal die letzten 30 Tage). Gibt die Anzahl zurück."""
    t = conn.execute("SELECT positionen_bis FROM trackers WHERE id = %s", (tracker_id,)).fetchone()
    jetzt = int(time.time())
    von = (t["positionen_bis"] - 3600) if t and t["positionen_bis"] else jetzt - BACKFILL_TAGE * 86400
    anzahl = 0
    while von < jetzt:
        bis = min(von + BLOCK_TAGE * 86400, jetzt)
        punkte = client.positionen(tracker_id, von, bis)
        if punkte:
            with conn.cursor() as cur:
                cur.executemany(
                    "INSERT INTO positions (tracker_id, ts, lat, lon, genauigkeit_m, sensor) "
                    "VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
                    [(tracker_id, *p) for p in punkte],
                )
        anzahl += len(punkte)
        conn.execute("UPDATE trackers SET positionen_bis = %s WHERE id = %s", (bis, tracker_id))
        conn.commit()
        von = bis
        if von < jetzt:
            time.sleep(2)   # Tractive begrenzt die Abfragen
    return anzahl


def runden_berechnen(conn, tracker_id: str) -> int:
    """Erkennt alle Runden neu aus den gespeicherten Positionen."""
    t = conn.execute("SELECT einstellungen FROM trackers WHERE id = %s", (tracker_id,)).fetchone()
    cfg = runden.einstellungen(t["einstellungen"] if t else None)
    pts = [(r["ts"], r["lat"], r["lon"], r["genauigkeit_m"]) for r in conn.execute(
        "SELECT ts, lat, lon, genauigkeit_m FROM positions WHERE tracker_id = %s ORDER BY ts", (tracker_id,))]
    if cfg["zuhause_lat"] is not None and cfg["zuhause_lon"] is not None:
        zuhause = (float(cfg["zuhause_lat"]), float(cfg["zuhause_lon"]))
    else:
        zuhause = runden.finde_zuhause(pts)
        conn.execute("UPDATE trackers SET zuhause_auto = %s WHERE id = %s",
                     (Jsonb({"lat": zuhause[0], "lon": zuhause[1]}) if zuhause else None, tracker_id))
    erkannt = runden.erkenne_runden(pts, zuhause, cfg) if zuhause else []
    conn.execute("DELETE FROM walks WHERE tracker_id = %s", (tracker_id,))
    with conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO walks (tracker_id, start_ts, ende_ts, dauer_s, strecke_m, max_entfernung_m, "
            "start_zuhause, ende_zuhause, punkte) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) "
            "ON CONFLICT DO NOTHING",
            [(tracker_id, r["start_ts"], r["ende_ts"], r["dauer_s"], r["strecke_m"], r["max_entfernung_m"],
              r["start_zuhause"], r["ende_zuhause"], Jsonb(r["punkte"])) for r in erkannt],
        )
    conn.commit()
    return len(erkannt)


def aktivitaet_laden(conn, tracker_id: str, client: Client) -> dict | None:
    t = conn.execute("SELECT pet_id FROM trackers WHERE id = %s", (tracker_id,)).fetchone()
    if not t or not t["pet_id"]:
        return None
    a = client.aktivitaet_heute(t["pet_id"])
    jetzt = datetime.now(TZ)
    vollstaendig = jetzt.hour * 60 + jetzt.minute >= 23 * 60 + 50
    conn.execute(
        "INSERT INTO activity_days (tracker_id, tag, minuten_aktiv, segmente, abgerufen_at, vollstaendig) "
        "VALUES (%s, %s, %s, %s, now(), %s) ON CONFLICT (tracker_id, tag) DO UPDATE SET "
        "minuten_aktiv = EXCLUDED.minuten_aktiv, segmente = EXCLUDED.segmente, abgerufen_at = now(), "
        "vollstaendig = activity_days.vollstaendig OR EXCLUDED.vollstaendig",
        (tracker_id, a["tag"], a["minuten_aktiv"], Jsonb(a["segmente"]), vollstaendig),
    )
    conn.commit()
    return a


def position_laden(conn, tracker_id: str, client: Client) -> dict:
    pos = client.aktuelle_position(tracker_id)
    conn.execute("UPDATE trackers SET letzte_position = %s, akku = %s WHERE id = %s",
                 (Jsonb(pos), pos.get("akku"), tracker_id))
    conn.commit()
    return pos


# ---------------------------------------------------------------------------
# Komplettabgleich
# ---------------------------------------------------------------------------
def tracker_abgleichen(tracker_id: str, aktivitaet: bool = True) -> None:
    """Positionen, Runden, aktuelle Position und (optional) Aktivität eines Trackers aktualisieren."""
    sperre = _sperre(tracker_id)
    if not sperre.acquire(blocking=False):
        return   # läuft bereits
    try:
        with storage.connect() as conn:
            try:
                def aufgabe(client):
                    n = positionen_laden(conn, tracker_id, client)
                    position_laden(conn, tracker_id, client)
                    if aktivitaet:
                        aktivitaet_laden(conn, tracker_id, client)
                    return n
                n = mit_tracker_client(conn, tracker_id, aufgabe)
                r = runden_berechnen(conn, tracker_id)
                conn.execute("UPDATE trackers SET letzter_sync = now(), sync_fehler = NULL WHERE id = %s", (tracker_id,))
                conn.commit()
                log.info("Tracker %s: %d neue Positionen, %d Runden", tracker_id, n, r)
            except Exception as e:
                conn.rollback()
                conn.execute("UPDATE trackers SET sync_fehler = %s WHERE id = %s", (str(e)[:500], tracker_id))
                conn.commit()
                log.warning("Tracker %s: %s", tracker_id, e)
    finally:
        sperre.release()


def alle_abgleichen(aktivitaet: bool = True) -> None:
    with storage.connect() as conn:
        ids = [r["tracker_id"] for r in conn.execute("SELECT DISTINCT tracker_id FROM user_trackers")]
    for tid in ids:
        tracker_abgleichen(tid, aktivitaet=aktivitaet)


def nur_aktivitaet_alle() -> None:
    """Für den Abruf um 23:55: nur den Aktivitätsverlauf speichern."""
    with storage.connect() as conn:
        ids = [r["tracker_id"] for r in conn.execute("SELECT DISTINCT tracker_id FROM user_trackers")]
        for tid in ids:
            try:
                mit_tracker_client(conn, tid, lambda c: aktivitaet_laden(conn, tid, c))
            except Exception as e:
                conn.rollback()
                log.warning("Aktivität %s: %s", tid, e)
