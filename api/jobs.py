"""Zeitplan: Positionen regelmäßig abgleichen, Aktivität um 23:55 vollständig sichern.

Läuft nur mit SCHEDULER_ENABLED=true (im Docker-Betrieb gesetzt, lokal aus).
"""
from __future__ import annotations

import logging
import os

from apscheduler.schedulers.background import BackgroundScheduler

from core import sync
from core.zeit import TZ

log = logging.getLogger("jobs")
_planer: BackgroundScheduler | None = None


def aktiv() -> bool:
    return os.environ.get("SCHEDULER_ENABLED", "").strip().lower() == "true"


def start() -> None:
    global _planer
    if not aktiv() or _planer:
        return
    minuten = int(os.environ.get("SYNC_MINUTEN", "15"))
    _planer = BackgroundScheduler(timezone=TZ)
    _planer.add_job(sync.alle_abgleichen, "interval", minutes=minuten, id="abgleich",
                    max_instances=1, coalesce=True)
    _planer.add_job(sync.nur_aktivitaet_alle, "cron", hour=23, minute=55, id="aktivitaet",
                    max_instances=1, coalesce=True, misfire_grace_time=240)
    _planer.start()
    log.info("Zeitplan aktiv: Abgleich alle %d min, Aktivität täglich 23:55", minuten)


def stop() -> None:
    global _planer
    if _planer:
        _planer.shutdown(wait=False)
        _planer = None
