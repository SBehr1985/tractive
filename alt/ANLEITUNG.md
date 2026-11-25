# Gassi-Runden – Anleitung

## Zugangsdaten: Datei `.env`
Alle Logins stehen in der Datei `.env` (Vorlage: `.env.example`). Sie wird nicht in Git eingecheckt (`.gitignore`).

| Eintrag | Bedeutung |
|---|---|
| `TRACTIVE_EMAIL` | deine Tractive-E-Mail |
| `TRACTIVE_PASSWORT` | optional. Leer = das Skript fragt bei Bedarf (sicherer). Gespeichert wird sonst nur das Anmelde-Token in `daten/token.json`. |
| `MAPTILER_KEY` | dein MapTiler-API-Schlüssel (cloud.maptiler.com → Account → API keys) |
| `MAPTILER_STIL` | Kartenstil, z. B. `streets-v2`, `outdoor-v2`, `topo-v2`, `basic-v2`, `hybrid` |

Ohne MapTiler-Schlüssel zeigt der Bericht OpenStreetMap an.

**Wichtig zum MapTiler-Schlüssel:** Karten werden im Browser geladen, deshalb steht der Schlüssel
im erzeugten `gassi_bericht.html`. Diese Datei also nicht weitergeben. Am besten in MapTiler
einen eigenen Schlüssel nur für dieses Projekt anlegen. Den kannst du jederzeit löschen, ohne andere
Projekte zu stören.

## Starten
```
python gassi.py
```
Der Bericht `gassi_bericht.html` öffnet sich im Browser. In der Karte kannst du oben rechts
zwischen **Karte**, **Outdoor** und **Satellit** wechseln.

Ohne Login ausprobieren: `python gassi.py --demo`

## Einstellungen in config.json
| Einstellung | Bedeutung |
|---|---|
| `zuhause` | Koordinaten deines Zuhauses. Leer = wird automatisch erkannt (wo der Hund nachts ist). `radius_m` = ab dieser Entfernung gilt der Hund als „unterwegs“. |
| `pause_min` / `pause_radius_m` | Bleibt der Hund so lange an einem Ort, endet die Runde dort (z. B. Café, Besuch). Geht es danach weiter, beginnt eine neue Runde. |
| `min_dauer_min` / `min_strecke_m` | Kürzere Ausflüge (z. B. kurz in den Garten) werden ignoriert. |
| `tage_laden` | Wie viele Tage zurück geladen werden. |
| `hundename` | Leer = Name aus Tractive. |

Weitere Feinheiten (Autofahrt-Erkennung, GPS-Genauigkeit, Datenlücken) stehen oben in `gassi.py` unter `STANDARD`.

## Aktivitätsdaten (Bewegungssensor)
Tractive liefert den minutengenauen Aktivitätsverlauf (Schlafen / Ruhe / Aktiv) **nur für den heutigen Tag**.
Das Skript speichert ihn bei jedem Lauf in `daten/aktivitaet/`. Der Reiter **Aktivität** im Bericht zeigt
die aktiven Minuten pro Tag und den Tagesverlauf (Aktiv / Ruhe / Schlaf) mit den GPS-Gassirunden darunter.

Für den vollständigen Tag jeden Abend um 23:55 nur die Aktivität abrufen:
```
python gassi.py --nur-aktivitaet
```
Ergebnis und Fehler stehen in `daten/protokoll.txt`. Läuft der Login ab (ca. alle 2 Monate), steht das dort;
dann `python gassi.py` einmal von Hand starten und das Passwort eingeben.

Die Runden werden standardmäßig nur aus GPS bestimmt. Mit `"runden_mit_aktivitaet": true` in config.json
werden Start und Ende zusätzlich an die Aktivitätsdaten angepasst.

## Gut zu wissen
- Bereits geladene Tage werden in `daten/positionen/` zwischengespeichert, nur der heutige Tag wird jedes Mal neu geladen.
- Tractive begrenzt die Zahl der Abfragen. Das Skript lädt deshalb bis zu 7 Tage auf einmal und wartet bei Bedarf automatisch.
- Der Tracker sendet normal nur alle 2–3 Minuten eine Position, deshalb sind die km eher etwas zu niedrig. Im LIVE-Modus wird die Strecke viel genauer.
- Tractive hat keine offizielle Schnittstelle. Ändert Tractive etwas, muss das Skript evtl. angepasst werden.
