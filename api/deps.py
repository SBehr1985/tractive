"""Gemeinsame Abhängigkeiten: DB-Verbindung je Anfrage, angemeldeter Benutzer, Zugriff auf einen Hund."""
from __future__ import annotations

from fastapi import Cookie, Depends, HTTPException, status

from core import storage

SESSION_COOKIE = "gassi_session"


def get_db():
    conn = storage.connect()
    try:
        yield conn
    finally:
        conn.close()


def get_current_user(gassi_session: str | None = Cookie(default=None), conn=Depends(get_db)) -> dict:
    if not gassi_session:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Nicht angemeldet.")
    row = conn.execute(
        "SELECT u.id, u.email, u.token_ok, u.token_expires_at, s.expires_at < now() AS abgelaufen "
        "FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = %s",
        (gassi_session,),
    ).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sitzung ungültig.")
    if row["abgelaufen"]:
        conn.execute("DELETE FROM sessions WHERE token = %s", (gassi_session,))
        conn.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sitzung abgelaufen.")
    return row


def hund_pruefen(conn, user: dict, tracker_id: str) -> None:
    """Nur Hunde, die im Tractive-Konto des Benutzers hängen, sind sichtbar."""
    ok = conn.execute("SELECT 1 FROM user_trackers WHERE user_id = %s AND tracker_id = %s",
                      (user["id"], tracker_id)).fetchone()
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hund nicht gefunden.")
