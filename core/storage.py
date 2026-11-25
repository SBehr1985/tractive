"""PostgreSQL-Zugriff (psycopg 3). Verbindung über DATABASE_URL."""
from __future__ import annotations

import os
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

SCHEMA = Path(__file__).resolve().parents[1] / "db" / "schema.sql"

__all__ = ["connect", "init_db", "Jsonb"]


def _url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError("DATABASE_URL ist nicht gesetzt (siehe .env.example).")
    return url


def connect() -> psycopg.Connection:
    return psycopg.connect(_url(), row_factory=dict_row)


def init_db() -> None:
    with connect() as conn:
        conn.execute(SCHEMA.read_text(encoding="utf-8"))
