-- EarlyEye Advanced Features Migration (CUT List & SHOULD Implementations)
-- Run this in Supabase SQL Editor.

-- 1. Enable pgvector extension for knowledge bank
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Knowledge Bank Table (SOPs, Penal Codes, KPM Bullying Guidelines, Warden Protocols)
CREATE TABLE IF NOT EXISTS knowledge_documents (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL, -- 'sop', 'legal', 'de_escalation', 'site_policy'
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    embedding vector(1536), -- compatible with text-embedding-3-small or OpenAI embeddings
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_documents(category);

-- 3. Notification Log Table (Dispatched alerts, WhatsApp links, Webhooks)
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    incident_id TEXT REFERENCES events(incident_id) ON DELETE CASCADE,
    recipient_name TEXT NOT NULL,
    recipient_contact TEXT NOT NULL, -- phone or webhook URL
    channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'webhook', 'in_app')),
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('queued', 'sent', 'delivered', 'failed')),
    sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_incident ON notifications(incident_id);

-- 4. Incident Clips & Keyframes Table
CREATE TABLE IF NOT EXISTS incident_clips (
    id SERIAL PRIMARY KEY,
    incident_id TEXT NOT NULL REFERENCES events(incident_id) ON DELETE CASCADE,
    clip_url TEXT NOT NULL,
    thumbnail_url TEXT,
    duration_seconds REAL DEFAULT 10.0,
    fps INT DEFAULT 25,
    camera_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clips_incident ON incident_clips(incident_id);

-- 5. Users & Role Management Table (Auth)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('operator', 'warden', 'security_manager', 'admin')),
    site_id TEXT REFERENCES sites(site_id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Vector Similarity Search Function for pgvector
CREATE OR REPLACE FUNCTION match_knowledge(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.5,
    match_count int DEFAULT 5
)
RETURNS TABLE (
    id int,
    title text,
    category text,
    content text,
    metadata jsonb,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        kd.id,
        kd.title,
        kd.category,
        kd.content,
        kd.metadata,
        1 - (kd.embedding <=> query_embedding) AS similarity
    FROM knowledge_documents kd
    WHERE 1 - (kd.embedding <=> query_embedding) > match_threshold
    ORDER BY kd.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
