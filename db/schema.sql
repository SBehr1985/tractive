-- Schema der Gassi-App. Wird beim Start automatisch angelegt/ergänzt (idempotent).

-- Benutzer = Tractive-Konten. Das Passwort wird nie gespeichert, nur das Tractive-Token (verschlüsselt).
CREATE TABLE IF NOT EXISTS users (
    id                  BIGSERIAL PRIMARY KEY,
    tractive_user_id    TEXT NOT NULL UNIQUE,
    email               TEXT NOT NULL,
    token_enc           TEXT,              -- Fernet-verschlüsseltes Tractive-Access-Token
    token_expires_at    BIGINT,            -- Unix-Sekunden
    token_ok            BOOLEAN NOT NULL DEFAULT TRUE,  -- false, wenn Tractive das Token ablehnt
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL
);

-- Ein Tracker = ein Hund. Mehrere Tractive-Konten können denselben Tracker sehen.
CREATE TABLE IF NOT EXISTS trackers (
    id                  TEXT PRIMARY KEY,   -- Tractive-Tracker-ID
    pet_id              TEXT,
    name                TEXT,
    einstellungen       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- Zuhause, Schwellwerte der Rundenerkennung
    zuhause_auto        JSONB,              -- automatisch erkanntes Zuhause {lat, lon}
    akku                INTEGER,
    letzte_position     JSONB,
    positionen_bis      BIGINT,             -- bis hierher sind Positionen geladen (Unix-Sekunden)
    letzter_sync        TIMESTAMPTZ,
    sync_fehler         TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_trackers (
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tracker_id  TEXT NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, tracker_id)
);

CREATE TABLE IF NOT EXISTS positions (
    tracker_id      TEXT NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
    ts              BIGINT NOT NULL,
    lat             DOUBLE PRECISION NOT NULL,
    lon             DOUBLE PRECISION NOT NULL,
    genauigkeit_m   REAL,
    sensor          TEXT,
    PRIMARY KEY (tracker_id, ts)
);

-- Aktivitätsverlauf (Bewegungssensor). Tractive liefert ihn nur für "heute",
-- deshalb wird er tagsüber und um 23:55 abgerufen und hier aufbewahrt.
CREATE TABLE IF NOT EXISTS activity_days (
    tracker_id      TEXT NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
    tag             DATE NOT NULL,
    minuten_aktiv   INTEGER,
    segmente        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [[start_ts, ende_ts, zustand], ...]
    abgerufen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    vollstaendig    BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (tracker_id, tag)
);

-- Erkannte Gassirunden (werden aus den Positionen neu berechnet).
CREATE TABLE IF NOT EXISTS walks (
    tracker_id          TEXT NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
    start_ts            BIGINT NOT NULL,
    ende_ts             BIGINT NOT NULL,
    dauer_s             INTEGER NOT NULL,
    strecke_m           INTEGER NOT NULL,
    max_entfernung_m    INTEGER NOT NULL,
    start_zuhause       BOOLEAN NOT NULL,
    ende_zuhause        BOOLEAN NOT NULL,
    punkte              JSONB NOT NULL,     -- [[lat, lon, ts], ...]
    PRIMARY KEY (tracker_id, start_ts)
);
