-- EarlyEye standing guard posts + guard app. Run once in the Supabase SQL editor, after
-- migration_live_loop.sql. Safe to re-run. Before it runs, GET /plan answers with posts generated
-- from hotspots, GET /site returns staff without names/photos, and the PATCH /events phone fields
-- (arrived_at, outcome, outcome_at) are dropped silently.

-- ── Team: name stays the call sign; display name, photo and shift are new ────
ALTER TABLE staff ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS photo_url    TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS shift        JSONB;   -- {label, days[0=Mon], from "HH:MM", to "HH:MM"}
ALTER TABLE staff ADD COLUMN IF NOT EXISTS on_duty      BOOLEAN;

-- Demo team (web/public/mock/site.json). Photos are illustrations served by the web app.
INSERT INTO staff (staff_id, site_id, name, role, zone, display_name, photo_url, shift)
SELECT t.staff_id, s.site_id, t.name, t.role, t.zone, t.display_name, t.photo_url, t.shift::jsonb
FROM (SELECT site_id FROM sites LIMIT 1) s,
     (VALUES
       ('STF-GUARD-A',  'Guard A',  'guard',  'canteen',         'Tan Wei Jie',  '/mock/staff/guard-a.svg',
        '{"label":"Mon–Sat 07:00–15:00","days":[0,1,2,3,4,5],"from":"07:00","to":"15:00"}'),
       ('STF-GUARD-B',  'Guard B',  'guard',  'stairwell',       'Aiman Hakimi', '/mock/staff/guard-b.svg',
        '{"label":"Mon–Sat 10:00–18:00","days":[0,1,2,3,4,5],"from":"10:00","to":"18:00"}'),
       ('STF-GUARD-C',  'Guard C',  'guard',  'hostel_corridor', 'Priya Nair',   '/mock/staff/guard-c.svg',
        '{"label":"Every day 14:00–23:00","days":[0,1,2,3,4,5,6],"from":"14:00","to":"23:00"}'),
       ('STF-WARDEN-D', 'Warden D', 'warden', 'hostel_corridor', 'Rosnah Ahmad', '/mock/staff/warden-d.svg',
        '{"label":"Fri–Sat 21:00–02:00","days":[4,5],"from":"21:00","to":"02:00"}')
     ) AS t(staff_id, name, role, zone, display_name, photo_url, shift)
ON CONFLICT (staff_id) DO UPDATE SET display_name = EXCLUDED.display_name,
  photo_url = EXCLUDED.photo_url, shift = EXCLUDED.shift, role = EXCLUDED.role, zone = EXCLUDED.zone;
-- The Grand Hall Guard B row from migration_live_loop.sql is the same person.
UPDATE staff SET display_name = 'Aiman Hakimi', photo_url = '/mock/staff/guard-b.svg',
  shift = '{"label":"Mon–Sat 10:00–18:00","days":[0,1,2,3,4,5],"from":"10:00","to":"18:00"}'::jsonb
WHERE staff_id = 'STF-GUARD-B-AU';

-- ── Guard app fields on events ───────────────────────────────────────────────
ALTER TABLE events ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS outcome    TEXT CHECK (outcome IN ('sorted','hurt','backup','nothing'));
ALTER TABLE events ADD COLUMN IF NOT EXISTS outcome_at TIMESTAMPTZ;

-- ── Standing posts ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plan_slots (
    id                        TEXT PRIMARY KEY,           -- P1, P2, …
    location                  TEXT NOT NULL,
    zone_type                 TEXT,
    days                      TEXT NOT NULL,              -- "Mon–Thu"
    hours                     TEXT NOT NULL,              -- "13:00–14:00"
    incidents_4w              INT  NOT NULL DEFAULT 0,
    expected_avoided_per_week REAL NOT NULL DEFAULT 0,
    rationale                 TEXT NOT NULL DEFAULT '',
    status                    TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suggested','ended')),
    since                     TIMESTAMPTZ,
    assigned_to               TEXT,                       -- call sign
    seen_at                   TIMESTAMPTZ,
    tip                       TEXT,
    suggestion                TEXT CHECK (suggestion IN ('add','end')),
    evidence                  JSONB DEFAULT '[]'::jsonb,  -- start_time of the incidents behind a suggestion
    ended_at                  TIMESTAMPTZ,                -- ended / "Not now"; comes back only with 3 newer incidents
    created_at                TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE plan_slots ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS plan_checkins (
    id      BIGSERIAL PRIMARY KEY,
    slot_id TEXT NOT NULL REFERENCES plan_slots(id) ON DELETE CASCADE,
    staff   TEXT NOT NULL,
    at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS plan_checkins_at ON plan_checkins (at);

-- last_check = the last daily 06:00 recheck
CREATE TABLE IF NOT EXISTS plan_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
