-- Incidents "How it unfolded" (contract §6): the camera's own timeline, every level change with the
-- model's score, and when the edge's recording starts. Safe to re-run; the API drops both fields until it runs.

ALTER TABLE events ADD COLUMN IF NOT EXISTS timeline   JSONB;
ALTER TABLE events ADD COLUMN IF NOT EXISTS clip_start TIMESTAMPTZ;
