-- EarlyEye Database Schema
-- Run this in Supabase SQL Editor to create all tables.
-- Matches the contract in §6 of earlyeye-TEAM-FINAL.md.

-- ── Sites ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sites (
    site_id    TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    site_type  TEXT NOT NULL CHECK (site_type IN ('campus', 'school', 'mall', 'factory', 'transit')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Zones ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS zones (
    id        SERIAL PRIMARY KEY,
    site_id   TEXT NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
    zone_type TEXT NOT NULL,
    label     TEXT NOT NULL,
    risk      REAL NOT NULL DEFAULT 0.5 CHECK (risk >= 0 AND risk <= 1)
);

-- ── Cameras ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cameras (
    camera_id     TEXT PRIMARY KEY,
    site_id       TEXT NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
    location      TEXT NOT NULL,
    zone_type     TEXT NOT NULL,
    online        BOOLEAN DEFAULT TRUE,
    last_frame_at TIMESTAMPTZ,
    black_since   TIMESTAMPTZ
);

-- ── Staff ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS staff (
    staff_id TEXT PRIMARY KEY,
    site_id  TEXT NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    role     TEXT NOT NULL,
    zone     TEXT
);

-- ── Events (incident log — the core table) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS events (
    incident_id   TEXT PRIMARY KEY,
    camera_id     TEXT REFERENCES cameras(camera_id),
    location      TEXT NOT NULL,
    zone_type     TEXT NOT NULL,
    start_time    TIMESTAMPTZ NOT NULL,
    end_time      TIMESTAMPTZ,
    type          TEXT NOT NULL CHECK (type IN ('fight', 'cornering', 'crowd', 'play')),
    level         TEXT NOT NULL CHECK (level IN ('calm', 'tense', 'fight_likely', 'fight')),
    peak_score    REAL NOT NULL CHECK (peak_score >= 0 AND peak_score <= 1),
    eta_seconds   REAL,
    priority      REAL NOT NULL CHECK (priority >= 0 AND priority <= 1),
    reason        TEXT NOT NULL,
    people_count  INT NOT NULL CHECK (people_count >= 1),
    action        TEXT NOT NULL,
    nearest_staff TEXT,
    pushed_to     TEXT,
    pushed_at     TIMESTAMPTZ,
    status        TEXT NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new', 'pushed', 'confirmed', 'dismissed', 'resolved', 'false_alarm')),
    staff_note    TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for the hot queries
CREATE INDEX IF NOT EXISTS idx_events_start_time ON events(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_events_status     ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_camera     ON events(camera_id);
CREATE INDEX IF NOT EXISTS idx_events_location   ON events(location, zone_type);

-- ── Proof (single-row, ML team updates it) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS proof (
    id         SERIAL PRIMARY KEY,
    data       JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Sequence for incident IDs ────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS incident_id_seq START WITH 1;
