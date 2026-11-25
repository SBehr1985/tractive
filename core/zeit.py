"""Zeitzone der App (Tagesgrenzen, Zeitplan). Der Server selbst läuft in UTC."""
import os
from zoneinfo import ZoneInfo

TZ = ZoneInfo(os.environ.get("APP_TIMEZONE", "Europe/Berlin"))
