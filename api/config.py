"""
EarlyEye API — Configuration

All secrets come from environment variables (set in Render dashboard).
Never commit actual values.
"""

import os
from dotenv import load_dotenv

# Load local .env if present
load_dotenv()


# ── Supabase ──────────────────────────────────────────────────────────────────
SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY: str = os.getenv("SUPABASE_KEY", "")  # service-role or anon key

# ── AI Keys (SHOULD & CUT: Agent, RAG, Weekly Report) ─────────────────────────
ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL: str = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")

# ── Auth & Security ───────────────────────────────────────────────────────────
JWT_SECRET: str = os.getenv("JWT_SECRET", "earlyeye-dormathon-secret-jwt-key-2026")
JWT_ALGORITHM: str = "HS256"
JWT_EXPIRE_HOURS: int = int(os.getenv("JWT_EXPIRE_HOURS", "24"))

# ── Notifications ─────────────────────────────────────────────────────────────
DEFAULT_ALERT_WEBHOOK_URL: str = os.getenv("DEFAULT_ALERT_WEBHOOK_URL", "")

# ── CORS ──────────────────────────────────────────────────────────────────────
CORS_ORIGINS: list[str] = os.getenv("CORS_ORIGINS", "*").split(",")

# ── App ───────────────────────────────────────────────────────────────────────
APP_TITLE: str = "EarlyEye API"
APP_VERSION: str = "0.1.0"
APP_DESCRIPTION: str = (
    "Backend for EarlyEye — physical-aggression early warning system. "
    "Receives event records from the edge app, serves them to the dashboard, "
    "and provides hotspot / patrol-plan analytics."
)
