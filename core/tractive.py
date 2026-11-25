"""Zugriff auf die (inoffizielle) Tractive-Schnittstelle.

Tractive bietet keine offizielle API an; das ist dieselbe Schnittstelle, die die
Tractive-App nutzt. Ändert Tractive sie, muss dieses Modul angepasst werden.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

from .zeit import TZ

API = "https://graph.tractive.com/4/"
APS_API = "https://aps-api.tractive.com/api/1/"   # Gesundheits-/Aktivitätsdaten
CLIENT_ID = "625e533dc3c3b41c28a669f0"            # Client-Kennung der Tractive-Web-App


class TractiveFehler(RuntimeError):
    def __init__(self, status: int, text: str):
        super().__init__(f"Tractive-Fehler {status}: {text}")
        self.status = status


class LoginFalsch(TractiveFehler):
    pass


def _anfrage(methode, url, body=None, params=None, token=None, user_id=None, versuche=True):
    if params:
        url += "?" + urllib.parse.urlencode(params)
    headers = {
        "X-Tractive-Client": CLIENT_ID,
        "Content-Type": "application/json;charset=UTF-8",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
        headers["X-Tractive-User"] = user_id
    daten = json.dumps(body).encode() if body is not None else None
    wartezeiten = [10, 30, 60] if versuche else []
    for versuch in range(len(wartezeiten) + 1):
        req = urllib.request.Request(url, data=daten, headers=headers, method=methode)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                text = r.read().decode("utf-8")
                return json.loads(text) if text else None
        except urllib.error.HTTPError as e:
            inhalt = e.read().decode("utf-8", "replace")[:300]
            if e.code == 429 and versuch < len(wartezeiten):
                time.sleep(wartezeiten[versuch])
                continue
            raise TractiveFehler(e.code, inhalt) from None
        except urllib.error.URLError as e:
            raise TractiveFehler(0, str(e.reason)) from None


def anmelden(email: str, passwort: str) -> dict:
    """Prüft die Zugangsdaten bei Tractive. Gibt {user_id, access_token, expires_at} zurück."""
    try:
        r = _anfrage("POST", API + "auth/token", body={
            "platform_email": email, "platform_token": passwort, "grant_type": "tractive",
        }, versuche=False)
    except TractiveFehler as e:
        if e.status in (400, 401, 403):
            raise LoginFalsch(e.status, "E-Mail oder Passwort falsch") from None
        raise
    return {"user_id": r["user_id"], "access_token": r["access_token"], "expires_at": int(r.get("expires_at") or 0)}


class Client:
    """Zugriff im Namen eines angemeldeten Tractive-Kontos."""

    def __init__(self, user_id: str, token: str):
        self.user_id, self.token = user_id, token

    def _get(self, pfad, params=None, basis=API):
        return _anfrage("GET", basis + pfad, params=params, token=self.token, user_id=self.user_id)

    def hunde(self) -> list[dict]:
        """Alle Tracker des Kontos mit Hundename: [{tracker_id, pet_id, name}]."""
        tracker = {t["_id"] for t in self._get(f"user/{self.user_id}/trackers") or []}
        hunde, gesehen = [], set()
        for obj in self._get(f"user/{self.user_id}/trackable_objects") or []:
            d = self._get(f"trackable_object/{obj['_id']}") or {}
            tid = d.get("device_id")
            if tid in tracker:
                hunde.append({"tracker_id": tid, "pet_id": obj["_id"], "name": (d.get("details") or {}).get("name") or "Hund"})
                gesehen.add(tid)
        for tid in tracker - gesehen:   # Tracker ohne zugeordnetes Tier
            hunde.append({"tracker_id": tid, "pet_id": None, "name": tid})
        return hunde

    def positionen(self, tracker_id: str, von_ts: int, bis_ts: int) -> list[tuple]:
        """[(ts, lat, lon, genauigkeit_m, sensor)]"""
        segmente = self._get(f"tracker/{tracker_id}/positions", params={
            "time_from": int(von_ts), "time_to": int(bis_ts), "format": "json_segments",
        }) or []
        punkte = []
        for seg in segmente:
            for p in seg:
                ll = p.get("latlong") or [None, None]
                if ll[0] is not None:
                    punkte.append((int(p["time"]), ll[0], ll[1], p.get("pos_uncertainty"), p.get("sensor_used")))
        return punkte

    def aktuelle_position(self, tracker_id: str) -> dict:
        p = self._get(f"device_pos_report/{tracker_id}") or {}
        hw = self._get(f"device_hw_report/{tracker_id}") or {}
        ll = p.get("latlong") or [None, None]
        return {"lat": ll[0], "lon": ll[1], "zeit": p.get("time"), "genauigkeit_m": p.get("pos_uncertainty"),
                "quelle": p.get("sensor_used"), "akku": hw.get("battery_level")}

    def aktivitaet_heute(self, pet_id: str) -> dict:
        """Aktivitätsverlauf von heute (Tractive liefert nur den aktuellen Tag).
        Die Abschnitte beziehen sich auf Mitternacht in der Zeitzone des Hundes (TZ)."""
        r = self._get(f"pet/{pet_id}/health/overview", basis=APS_API) or {}
        heute = datetime.now(TZ).date()
        t0 = datetime.combine(heute, datetime.min.time(), tzinfo=TZ).timestamp()
        segmente = [[int(t0 + s["startOffsetSeconds"]), int(t0 + s["startOffsetSeconds"] + s["durationSeconds"]), s["state"]]
                    for s in (r.get("stateTimeline") or {}).get("segments", [])]
        return {"tag": heute, "minuten_aktiv": (r.get("activity") or {}).get("minutesActive"), "segmente": segmente}
