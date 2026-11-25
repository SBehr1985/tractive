# Gassi-Runden – Start, Betrieb, Deployment

Web-App unter **https://tractive.sbgis.de**. Anmeldung mit dem Tractive-Konto: Das Passwort geht nur an
Tractive und wird nie gespeichert; gespeichert wird das Tractive-Token (verschlüsselt mit `TOKEN_KEY`).
Jeder sieht nur die Hunde aus seinem eigenen Tractive-Konto, ohne verbundenen Hund bleibt die App leer.

**Aufbau** (wie crnews): FastAPI (`api/`, `core/`), PostgreSQL 17, React/Vite (`webapp/`), Zeitplan im
App-Prozess (APScheduler), Docker. HTTPS macht der zentrale Caddy (`deploy/proxy`).

| Was | Wann |
|---|---|
| Positionen + aktuelle Position + Aktivität von Tractive holen, Runden neu berechnen | alle 15 Minuten (`SYNC_MINUTEN`) |
| Aktivitätsverlauf vollständig sichern (Tractive liefert ihn nur für „heute“) | täglich 23:55 |
| Erster Abruf eines neuen Hundes (letzte 30 Tage) | direkt nach der ersten Anmeldung |

## 1. Lokal entwickeln

Voraussetzungen: Python 3.12+, Node 20+, PostgreSQL.
```bash
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
cd webapp && npm install && cd ..
psql -U postgres -c "CREATE DATABASE gassi"
copy .env.example .env     # DATABASE_URL, TOKEN_KEY, MAPTILER_KEY, COOKIE_SECURE=false setzen
```
Zwei Terminals:
```bash
.venv\Scripts\python -m uvicorn api.main:app --reload --port 8010   # Backend
cd webapp && npm run dev                                           # Frontend: http://localhost:5180
```
Lokal läuft kein Zeitplan (nur mit `SCHEDULER_ENABLED=true`); „↻“ oben rechts holt die Daten von Hand.
Ohne Vite: `cd webapp && npm run build`, dann liefert das Backend die App unter http://localhost:8010 aus.

## 2. Erstinstallation auf dem Hetzner-Server

Server wie bei crnews: `ssh root@2.31.4.115`.

1. **DNS:** in konsoleH für sbgis.de einen A-Record `tractive` → `2.31.4.115` anlegen.
2. **Code auf GitHub** (eigenes, privates Repository) pushen.
3. **Gemeinsames Docker-Netz** (einmalig):
   ```bash
   docker network create web
   ```
4. **Gassi-App:**
   ```bash
   git clone <repo> /opt/gassi && cd /opt/gassi
   cp .env.example .env && nano .env    # POSTGRES_PASSWORD, TOKEN_KEY, MAPTILER_KEY
   docker compose up -d --build
   docker compose logs --tail 50 app
   ```
5. **Umstellung auf den zentralen Caddy** (crnews ist dabei ca. eine Minute nicht erreichbar):
   - crnews wie in `deploy/crnews-aenderung.md` beschrieben ändern, committen, pushen.
   - auf dem Server:
     ```bash
     cd /opt/crnews && git pull && docker compose up -d --remove-orphans   # alter Caddy geht weg, Ports frei
     mkdir -p /opt/proxy && cp /opt/gassi/deploy/proxy/* /opt/proxy/
     cd /opt/proxy && docker compose up -d
     ```
   - prüfen: https://crnews.sbgis.de/api/health und https://tractive.sbgis.de/api/health
6. **MapTiler-Schlüssel absichern:** in MapTiler unter „Allowed HTTP origins“ `tractive.sbgis.de` eintragen.

**Neue App später:** Container ins Netz `web` hängen (mit Alias), im `/opt/proxy/Caddyfile` einen Block ergänzen,
`docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`.

## 3. Alltag auf dem Server (im Ordner `/opt/gassi`)

| Befehl | Wirkung |
|---|---|
| `docker compose ps` | läuft alles? (`db`, `app`) |
| `docker compose logs --tail 50 app` | letzte Meldungen (Abgleich, Fehler) |
| `git pull && docker compose up -d --build` | neuen Stand holen und starten |
| `docker compose restart app` | nach Änderung der `.env` |
| `docker compose exec db psql -U gassi -d gassi` | Datenbank-Konsole (`\q` beendet) |

**Sicherung (automatisch):** jede Nacht um 03:30 legt `deploy/backup.sh` eine Datei
`/opt/backups/gassi/gassi_JJJJ-MM-TT.dump` an und behält die letzten 14 Tage. Protokoll: `/var/log/gassi-backup.log`.
Eingerichtet mit:
```bash
cp /opt/gassi/deploy/gassi-backup.cron /etc/cron.d/gassi-backup
```
Von Hand sichern: `/opt/gassi/deploy/backup.sh`. Zurückspielen (App vorher anhalten):
```bash
docker compose stop app
docker compose exec -T db pg_restore -U gassi -d gassi --clean --if-exists --no-owner < /opt/backups/gassi/gassi_2026-11-26.dump
docker compose start app
```
Die Sicherungen liegen auf demselben Server; gegen einen Totalausfall hilft nur eine Kopie woanders
(z. B. `scp root@2.31.4.115:/opt/backups/gassi/*.dump .`). Sie enthalten die verschlüsselten Tractive-Tokens:
nie in Git.

## 4. Gut zu wissen

- **Tractive-Token** laufen nach ca. zwei Monaten ab. Dann zeigt die App einen Hinweis; einmal ab- und wieder
  anmelden genügt. Solange ein anderes verbundenes Konto ein gültiges Token hat, läuft der Abgleich weiter.
- **`TOKEN_KEY`** nie ändern oder verlieren, sonst sind die gespeicherten Tokens unlesbar (alle müssen sich neu anmelden).
- **Inoffizielle Schnittstelle:** Ändert Tractive etwas, steht der Fehler unter Einstellungen → Datenabgleich und im Log.
- **Rundenerkennung** pro Hund unter Einstellungen (Zuhause, Radius, Pausen, Mindestdauer); nach dem Speichern
  werden alle Runden neu berechnet.
- Das frühere Einzelskript (HTML-Bericht) liegt unter `alt/`.
