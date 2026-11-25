"""Verschlüsselung der gespeicherten Tractive-Tokens (Fernet, Schlüssel aus TOKEN_KEY)."""
from __future__ import annotations

import os

from cryptography.fernet import Fernet


def _fernet() -> Fernet:
    key = os.environ.get("TOKEN_KEY", "").strip()
    if not key:
        raise RuntimeError("TOKEN_KEY ist nicht gesetzt. Erzeugen mit: "
                           "python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"")
    return Fernet(key.encode())


def pruefen() -> None:
    _fernet()


def verschluesseln(text: str) -> str:
    return _fernet().encrypt(text.encode()).decode()


def entschluesseln(text: str) -> str:
    return _fernet().decrypt(text.encode()).decode()
