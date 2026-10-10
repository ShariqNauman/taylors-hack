-- EarlyEye Web Push: one row per guard phone (guard app: Start my shift). Run once in Supabase.
-- Safe to re-run. Until it runs, POST /push/subscribe answers 503 and alarms only ring with the app open.
CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint     TEXT PRIMARY KEY,          -- the phone's push service URL
    staff        TEXT NOT NULL,             -- call sign ("Guard B")
    subscription JSONB NOT NULL,            -- the browser's PushSubscription (endpoint + keys)
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_staff ON push_subscriptions (staff);
