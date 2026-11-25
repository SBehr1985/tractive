#!/bin/sh
# Nächtliche Sicherung der Gassi-Datenbank (läuft per cron, siehe START.md).
# Legt je Tag eine Datei an und löscht Sicherungen, die älter als TAGE sind.
set -eu

ZIEL=/opt/backups/gassi
TAGE=14

mkdir -p "$ZIEL"
chmod 700 "$ZIEL"
DATEI="$ZIEL/gassi_$(date +%F).dump"

cd /opt/gassi
docker compose exec -T db pg_dump -U gassi -Fc gassi > "$DATEI.tmp"
mv "$DATEI.tmp" "$DATEI"
chmod 600 "$DATEI"

find "$ZIEL" -name 'gassi_*.dump' -mtime +"$TAGE" -delete
echo "$(date '+%F %T') OK $(du -h "$DATEI" | cut -f1) $DATEI"
