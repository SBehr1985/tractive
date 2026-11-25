# Änderung an crnews für den zentralen Caddy

Bisher startet crnews seinen eigenen Caddy auf Port 80/443. Mit dem zentralen Caddy (`/opt/proxy`)
gibt crnews die Ports ab und hängt seine App ins gemeinsame Netz `web`.

## In `docker-compose.yml` von crnews

1. Den kompletten Dienst `caddy:` entfernen.
2. Beim Dienst `app:` das Netz ergänzen:
   ```yaml
     app:
       <<: *app
       environment:
         ...                       # unverändert
       expose:
         - "8000"
       networks:
         default:
         web:
           aliases: [crnews-app]
   ```
3. Unter `volumes:` den Eintrag `caddy-data:` entfernen und am Ende ergänzen:
   ```yaml
   networks:
     web:
       external: true
   ```
4. Die Datei `Caddyfile` in crnews wird nicht mehr gebraucht (kann bleiben oder gelöscht werden).
   `DOMAIN` in der `.env` wird ebenfalls nicht mehr gebraucht.

Die Änderung lokal machen, committen, pushen und auf dem Server mit `git pull` holen
(siehe Umstellung in `START.md`, Schritt 4).
