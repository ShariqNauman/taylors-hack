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

# ── Anthropic (SHOULD: weekly report only) ────────────────────────────────────
ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")

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
