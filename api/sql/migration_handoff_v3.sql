-- EarlyEye Backend Handoff v3 Migration
-- Safe to re-run multiple times (uses IF NOT EXISTS).
-- Run this in Supabase SQL editor to ensure all tables, columns and seed data are in place.

-- ── 1. Events columns (live loop, guard responses, keypoints) ───────────────
ALTER TABLE events ADD COLUMN IF NOT EXISTS acked_at      TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS arrived_at    TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS outcome       TEXT CHECK (outcome IN ('sorted','hurt','backup','nothing'));
ALTER TABLE events ADD COLUMN IF NOT EXISTS outcome_at    TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE events ADD COLUMN IF NOT EXISTS snapshot      JSONB;
ALTER TABLE events ADD COLUMN IF NOT EXISTS peak_snapshot JSONB;
ALTER TABLE events ADD COLUMN IF NOT EXISTS top_features  JSONB;

CREATE OR REPLACE FUNCTION events_touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS events_touch ON events;
CREATE TRIGGER events_touch BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION events_touch_updated_at();

-- ── 2. Staff columns (guard duty app, shift schedule, geo post) ─────────────
ALTER TABLE staff ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS photo_url    TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS shift        JSONB;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS on_duty      BOOLEAN DEFAULT TRUE;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS post         JSONB;

-- ── 3. Camera columns (edge streams, telemetry, sensitivity preset) ─────────
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS source        TEXT DEFAULT 'recorded' CHECK (source IN ('live', 'recorded'));
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS recorded_at   TIMESTAMPTZ;
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS edge_url      TEXT;
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS people_count  INT DEFAULT 0;
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS geo           JSONB;
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS sensitivity   TEXT DEFAULT 'strict' CHECK (sensitivity IN ('strict', 'sensitive'));

-- ── 4. Standing patrol posts & checkins ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS plan_slots (
    id                        TEXT PRIMARY KEY,
    location                  TEXT NOT NULL,
    zone_type                 TEXT,
    days                      TEXT NOT NULL,
    hours                     TEXT NOT NULL,
    incidents_4w              INT  NOT NULL DEFAULT 0,
    expected_avoided_per_week REAL NOT NULL DEFAULT 0,
    rationale                 TEXT NOT NULL DEFAULT '',
    status                    TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suggested','ended')),
    since                     TIMESTAMPTZ,
    assigned_to               TEXT,
    seen_at                   TIMESTAMPTZ,
    tip                       TEXT,
    suggestion                TEXT CHECK (suggestion IN ('add','end')),
    evidence                  JSONB DEFAULT '[]'::jsonb,
    ended_at                  TIMESTAMPTZ,
    source                    TEXT DEFAULT 'model' CHECK (source IN ('model', 'manual')),
    geo                       JSONB,
    created_at                TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE plan_slots ADD COLUMN IF NOT EXISTS ended_at   TIMESTAMPTZ;
ALTER TABLE plan_slots ADD COLUMN IF NOT EXISTS source     TEXT DEFAULT 'model';
ALTER TABLE plan_slots ADD COLUMN IF NOT EXISTS geo        JSONB;

CREATE TABLE IF NOT EXISTS plan_checkins (
    id      BIGSERIAL PRIMARY KEY,
    slot_id TEXT NOT NULL REFERENCES plan_slots(id) ON DELETE CASCADE,
    staff   TEXT NOT NULL,
    at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_plan_checkins_at ON plan_checkins (at);

CREATE TABLE IF NOT EXISTS plan_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- ── 5. Seed staff & cameras (matching web/public/mock) ───────────────────────
INSERT INTO staff (staff_id, site_id, name, role, zone, display_name, photo_url, shift, on_duty, post)
SELECT t.staff_id, s.site_id, t.name, t.role, t.zone, t.display_name, t.photo_url, t.shift::jsonb, t.on_duty, t.post::jsonb
FROM (SELECT site_id FROM sites LIMIT 1) s,
     (VALUES
       ('STF-GUARD-A',  'Guard A',  'guard',  'canteen',         'Tan Wei Jie',  '/mock/staff/guard-a.svg',
        '{"label":"Mon–Sat 07:00–15:00","days":[0,1,2,3,4,5],"from":"07:00","to":"15:00"}', TRUE,
        '{"lat":3.0631104,"lng":101.6163152}'),
       ('STF-GUARD-B',  'Guard B',  'guard',  'stairwell',       'Aiman Hakimi', '/mock/staff/guard-b.svg',
        '{"label":"Mon–Sat 10:00–18:00","days":[0,1,2,3,4,5],"from":"10:00","to":"18:00"}', TRUE,
        '{"lat":3.0642137,"lng":101.6170619}'),
       ('STF-GUARD-C',  'Guard C',  'guard',  'hostel_corridor', 'Priya Nair',   '/mock/staff/guard-c.svg',
        '{"label":"Every day 14:00–23:00","days":[0,1,2,3,4,5,6],"from":"14:00","to":"23:00"}', TRUE,
        '{"lat":3.06406,"lng":101.6165401}'),
       ('STF-WARDEN-D', 'Warden D', 'warden', 'hostel_corridor', 'Rosnah Ahmad', '/mock/staff/warden-d.svg',
        '{"label":"Fri–Sat 21:00–02:00","days":[4,5],"from":"21:00","to":"02:00"}', FALSE,
        '{"lat":3.0642137,"lng":101.6160904}')
     ) AS t(staff_id, name, role, zone, display_name, photo_url, shift, on_duty, post)
ON CONFLICT (staff_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  photo_url = EXCLUDED.photo_url,
  shift = EXCLUDED.shift,
  on_duty = EXCLUDED.on_duty,
  post = EXCLUDED.post;

-- Live and recorded cameras seed
INSERT INTO cameras (camera_id, site_id, location, zone_type, online, source, edge_url, geo, sensitivity)
SELECT c.camera_id, s.site_id, c.location, c.zone_type, c.online, c.source, c.edge_url, c.geo::jsonb, c.sensitivity
FROM (SELECT site_id FROM sites LIMIT 1) s,
     (VALUES
       ('CAM-AU-01', 'Grand Hall', 'auditorium', TRUE, 'live', 'http://127.0.0.1:8765',
        '{"lat":3.0645574,"lng":101.6170349,"alt_m":10,"building":"Block B","floor":"level 2, stage left"}', 'strict'),
       ('CAM-BC-03', 'Block C stairwell', 'stairwell', TRUE, 'recorded', 'http://127.0.0.1:8766',
        '{"lat":3.0640871,"lng":101.6175477,"alt_m":8,"building":"Block C","floor":"level 1 landing"}', 'strict'),
       ('CAM-CT-04', 'Syopz Mall food court', 'canteen', TRUE, 'recorded', 'http://127.0.0.1:8767',
        '{"lat":3.0638158,"lng":101.6164681,"alt_m":8,"building":"Syopz Mall","floor":"east entrance"}', 'strict'),
       ('CAM-HC-01', 'U Residence, corridor L3', 'hostel_corridor', TRUE, 'recorded', 'http://127.0.0.1:8768',
        '{"lat":3.0642137,"lng":101.6160904,"alt_m":16,"building":"U Residence, above Syopz Mall","floor":"residence level 3"}', 'strict'),
       ('CAM-HC-02', 'U Residence, corridor L5', 'hostel_corridor', FALSE, 'recorded', '',
        '{"lat":3.0643042,"lng":101.6162883,"alt_m":22,"building":"U Residence, above Syopz Mall","floor":"residence level 5"}', 'strict'),
       ('CAM-SC-06', 'Sports pitch', 'sports_court', TRUE, 'recorded', 'http://127.0.0.1:8769',
        '{"lat":3.0617539,"lng":101.6172328,"alt_m":8,"building":"Sports centre","floor":"football pitch side"}', 'strict')
     ) AS c(camera_id, location, zone_type, online, source, edge_url, geo, sensitivity)
ON CONFLICT (camera_id) DO UPDATE SET
  location = EXCLUDED.location,
  zone_type = EXCLUDED.zone_type,
  online = EXCLUDED.online,
  source = EXCLUDED.source,
  edge_url = EXCLUDED.edge_url,
  geo = EXCLUDED.geo,
  sensitivity = EXCLUDED.sensitivity;
