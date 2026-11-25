"""Anmeldung mit dem Tractive-Konto.

Das Passwort wird nur an Tractive weitergereicht und nie gespeichert. Gespeichert wird
das Tractive-Token (verschlüsselt), damit der Server die Daten im Hintergrund abrufen kann.
"""
from __future__ import annotations

import os
import secrets
import threading
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel

from core import geheim, sync, tractive

from .deps import SESSION_COOKIE, get_current_user, get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])

COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "true").strip().lower() != "false"
SESSION_DAUER = timedelta(days=30)

# einfacher Schutz gegen Passwort-Raten: IP -> (Fehlversuche, gesperrt bis)
_fehlversuche: dict[str, tuple[int, datetime]] = {}
_MAX_VERSUCHE = 6
_SPERRE = timedelta(minutes=10)


class LoginAnfrage(BaseModel):
    email: str
    password: str


def benutzer_info(conn, user: dict) -> dict:
    hunde = conn.execute(
        "SELECT t.id, t.name FROM trackers t JOIN user_trackers ut ON ut.tracker_id = t.id "
        "WHERE ut.user_id = %s ORDER BY t.name", (user["id"],)).fetchall()
    return {"email": user["email"], "tractive_ok": bool(user["token_ok"]), "hunde": hunde}


@router.post("/login")
def login(body: LoginAnfrage, request: Request, response: Response, conn=Depends(get_db)):
    ip = request.client.host if request.client else "?"
    jetzt = datetime.now(timezone.utc)
    versuche, bis = _fehlversuche.get(ip, (0, jetzt))
    if versuche >= _MAX_VERSUCHE and jetzt < bis:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Zu viele Fehlversuche. Bitte später erneut versuchen.")

    email = body.email.strip().lower()
    try:
        t = tractive.anmelden(email, body.password)
    except tractive.LoginFalsch:
        _fehlversuche[ip] = (versuche + 1, jetzt + _SPERRE)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "E-Mail oder Passwort falsch.") from None
    except tractive.TractiveFehler as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Tractive ist gerade nicht erreichbar ({e.status}).") from None
    _fehlversuche.pop(ip, None)

    user = conn.execute(
        "INSERT INTO users (tractive_user_id, email, token_enc, token_expires_at, token_ok, last_login_at) "
        "VALUES (%s, %s, %s, %s, TRUE, now()) ON CONFLICT (tractive_user_id) DO UPDATE SET "
        "email = EXCLUDED.email, token_enc = EXCLUDED.token_enc, token_expires_at = EXCLUDED.token_expires_at, "
        "token_ok = TRUE, last_login_at = now() RETURNING id, email, token_ok",
        (t["user_id"], email, geheim.verschluesseln(t["access_token"]), t["expires_at"]),
    ).fetchone()
    conn.commit()

    try:
        tracker_ids = sync.hunde_des_benutzers_aktualisieren(conn, user["id"], tractive.Client(t["user_id"], t["access_token"]))
    except tractive.TractiveFehler as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Hunde konnten nicht geladen werden ({e.status}).") from None

    # neue Hunde sofort im Hintergrund laden (die ersten 30 Tage dauern ein paar Sekunden)
    neu = [r["id"] for r in conn.execute(
        "SELECT id FROM trackers WHERE id = ANY(%s) AND letzter_sync IS NULL", (tracker_ids,))]
    for tid in neu:
        threading.Thread(target=sync.tracker_abgleichen, args=(tid,), daemon=True).start()

    token = secrets.token_urlsafe(32)
    conn.execute("INSERT INTO sessions (token, user_id, expires_at) VALUES (%s, %s, %s)",
                 (token, user["id"], jetzt + SESSION_DAUER))
    conn.execute("DELETE FROM sessions WHERE expires_at < now()")
    conn.commit()
    response.set_cookie(SESSION_COOKIE, token, httponly=True, secure=COOKIE_SECURE, samesite="lax",
                        max_age=int(SESSION_DAUER.total_seconds()))
    return benutzer_info(conn, user)


@router.post("/logout")
def logout(request: Request, response: Response, conn=Depends(get_db)):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        conn.execute("DELETE FROM sessions WHERE token = %s", (token,))
        conn.commit()
    response.delete_cookie(SESSION_COOKIE)
    return {"ok": True}


@router.get("/me")
def me(user: dict = Depends(get_current_user), conn=Depends(get_db)):
    return benutzer_info(conn, user)
