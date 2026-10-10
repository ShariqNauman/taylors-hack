"""
EarlyEye — Seed site configuration.

Seeds the demo site (Taylor's Lakeside Campus), its zones, cameras, and staff.
Run once against your Supabase project:

    python -m api.seed.seed_site
"""

from __future__ import annotations

import os
import sys

# Allow running as `python -m api.seed.seed_site` from repo root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from api.db import get_supabase  # noqa: E402

# ── Demo Site: Taylor's Lakeside Campus ───────────────────────────────────────

SITE = {
    "site_id": "TAYLORS-LK",
    "name": "Taylor's Lakeside Campus",
    "site_type": "campus",
}

ZONES = [
    {"site_id": "TAYLORS-LK", "zone_type": "hostel_corridor", "label": "Asrama Puteri, koridor tingkat 3", "risk": 1.0},
    {"site_id": "TAYLORS-LK", "zone_type": "stairwell",       "label": "Block C stairwell",                "risk": 0.8},
    {"site_id": "TAYLORS-LK", "zone_type": "canteen",         "label": "Canteen",                          "risk": 0.7},
    {"site_id": "TAYLORS-LK", "zone_type": "car_park",        "label": "Car Park A",                       "risk": 0.6},
    {"site_id": "TAYLORS-LK", "zone_type": "sports_court",    "label": "Sports Court",                     "risk": 0.3},
]

CAMERAS = [
    {"camera_id": "CAM-ASR-03", "site_id": "TAYLORS-LK", "location": "Asrama Puteri, koridor tingkat 3", "zone_type": "hostel_corridor", "online": True,  "last_frame_at": None, "black_since": None},
    {"camera_id": "CAM-BLK-C1", "site_id": "TAYLORS-LK", "location": "Block C stairwell",                "zone_type": "stairwell",       "online": True,  "last_frame_at": None, "black_since": None},
    {"camera_id": "CAM-CAN-01", "site_id": "TAYLORS-LK", "location": "Canteen",                          "zone_type": "canteen",         "online": True,  "last_frame_at": None, "black_since": None},
    {"camera_id": "CAM-CPK-01", "site_id": "TAYLORS-LK", "location": "Car Park A",                       "zone_type": "car_park",        "online": True,  "last_frame_at": None, "black_since": None},
    {"camera_id": "CAM-SPT-01", "site_id": "TAYLORS-LK", "location": "Sports Court",                     "zone_type": "sports_court",    "online": True,  "last_frame_at": None, "black_since": None},
    # One dead camera — for the "black for 3 days" demo
    {"camera_id": "CAM-ASR-05", "site_id": "TAYLORS-LK", "location": "Asrama Puteri, tingkat 2",          "zone_type": "hostel_corridor", "online": False, "last_frame_at": "2026-10-08T03:12:00+08:00", "black_since": "2026-10-08T03:12:00+08:00"},
]

STAFF = [
    {"staff_id": "STAFF-A", "site_id": "TAYLORS-LK", "name": "Warden A",  "role": "warden",   "zone": "hostel_corridor"},
    {"staff_id": "STAFF-B", "site_id": "TAYLORS-LK", "name": "Warden B",  "role": "warden",   "zone": "stairwell"},
    {"staff_id": "STAFF-C", "site_id": "TAYLORS-LK", "name": "Guard C",   "role": "guard",    "zone": "canteen"},
    {"staff_id": "STAFF-D", "site_id": "TAYLORS-LK", "name": "Guard D",   "role": "guard",    "zone": "car_park"},
    {"staff_id": "STAFF-E", "site_id": "TAYLORS-LK", "name": "Guard E",   "role": "guard",    "zone": "sports_court"},
]


def seed():
    """Insert site config into Supabase. Upserts to be idempotent."""
    sb = get_supabase()

    print("Seeding site…")
    sb.table("sites").upsert(SITE, on_conflict="site_id").execute()

    print(f"Seeding {len(ZONES)} zones…")
    # Delete existing zones first (no natural key), then insert
    sb.table("zones").delete().eq("site_id", "TAYLORS-LK").execute()
    sb.table("zones").insert(ZONES).execute()

    print(f"Seeding {len(CAMERAS)} cameras…")
    for cam in CAMERAS:
        sb.table("cameras").upsert(cam, on_conflict="camera_id").execute()

    print(f"Seeding {len(STAFF)} staff…")
    for s in STAFF:
        sb.table("staff").upsert(s, on_conflict="staff_id").execute()

    print("✅ Site seed complete.")


if __name__ == "__main__":
    seed()
