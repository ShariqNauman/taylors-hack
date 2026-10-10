-- EarlyEye live loop (contract §6, approved 10 Oct 14:50). Run once in the Supabase SQL editor.
-- Safe to re-run. The API works before this runs (it drops unknown columns), but acked_at and
-- skeleton snapshots are only stored after it.

ALTER TABLE events ADD COLUMN IF NOT EXISTS acked_at      TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE events ADD COLUMN IF NOT EXISTS snapshot      JSONB;
ALTER TABLE events ADD COLUMN IF NOT EXISTS peak_snapshot JSONB;
ALTER TABLE events ADD COLUMN IF NOT EXISTS top_features  JSONB;

CREATE OR REPLACE FUNCTION events_touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS events_touch ON events;
CREATE TRIGGER events_touch BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION events_touch_updated_at();

-- Demo cameras (web/public/mock/cameras.json). CAM-AU-01 is the live webcam in the Grand Hall.
INSERT INTO cameras (camera_id, site_id, location, zone_type, online)
SELECT c.camera_id, s.site_id, c.location, c.zone_type, c.online
FROM (SELECT site_id FROM sites LIMIT 1) s,
     (VALUES ('CAM-AU-01', 'Grand Hall', 'auditorium', TRUE),
             ('CAM-BC-03', 'Block C stairwell', 'stairwell', TRUE),
             ('CAM-CT-04', 'Syopz Mall food court', 'canteen', TRUE),
             ('CAM-HC-01', 'U Residence, corridor L3', 'hostel_corridor', TRUE),
             ('CAM-HC-02', 'U Residence, corridor L5', 'hostel_corridor', FALSE),
             ('CAM-SC-06', 'Sports pitch', 'sports_court', TRUE)) AS c(camera_id, location, zone_type, online)
ON CONFLICT (camera_id) DO NOTHING;

-- Zone for the Grand Hall, and the person on duty there (the edge also sends nearest_staff).
INSERT INTO zones (site_id, zone_type, label, risk)
SELECT site_id, 'auditorium', 'Grand Hall', 0.5 FROM sites
WHERE NOT EXISTS (SELECT 1 FROM zones WHERE zone_type = 'auditorium') LIMIT 1;
INSERT INTO staff (staff_id, site_id, name, role, zone)
SELECT 'STF-GUARD-B-AU', site_id, 'Guard B', 'guard', 'auditorium' FROM sites LIMIT 1
ON CONFLICT (staff_id) DO NOTHING;
