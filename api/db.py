"""
EarlyEye API — Supabase database client.

Provides a singleton Supabase client used by all routers.
Uses supabase-py (the official Python SDK).
"""

from __future__ import annotations

from functools import lru_cache

from supabase import Client, create_client

from api.config import SUPABASE_KEY, SUPABASE_URL


@lru_cache(maxsize=1)
def get_supabase() -> Client:
    """Return a cached Supabase client (created once per process)."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_KEY must be set. "
            "Add them to your .env or Render environment variables."
        )
    return create_client(SUPABASE_URL, SUPABASE_KEY)
