"""
EarlyEye — Seed 8-week incident history with planted patterns.

Generates 350-450 realistic events over the past 8 weeks, ensuring:
1. Planted hotspot 1: "Block C stairwell", Mon-Thu 13:00-14:00 (5 incidents in last 4w)
2. Planted hotspot 2: "Asrama Puteri, koridor tingkat 3", weeknights 22:00-00:00 (4+ incidents)
3. Planted hotspot 3: "Car Park A", Fri 17:00-18:00 (3 incidents)
4. Background distribution across all cameras/zones/hours with realistic reasons, levels, types.

Run:
    python -m api.seed.seed_history
"""

from __future__ import annotations

import os
import random
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from api.db import get_supabase
from api.routers.events import compute_priority

CAMERAS_CONFIG = [
    {"camera_id": "CAM-ASR-03", "location": "Asrama Puteri, koridor tingkat 3", "zone_type": "hostel_corridor", "risk": 1.0, "staff": "Warden A"},
    {"camera_id": "CAM-BLK-C1", "location": "Block C stairwell",                "zone_type": "stairwell",       "risk": 0.8, "staff": "Warden B"},
    {"camera_id": "CAM-CAN-01", "location": "Canteen",                          "zone_type": "canteen",         "risk": 0.7, "staff": "Guard C"},
    {"camera_id": "CAM-CPK-01", "location": "Car Park A",                       "zone_type": "car_park",        "risk": 0.6, "staff": "Guard D"},
    {"camera_id": "CAM-SPT-01", "location": "Sports Court",                     "zone_type": "sports_court",    "risk": 0.3, "staff": "Guard E"},
]

REASON_TEMPLATES = [
    "wrist speed spiked; distance dropped below 0.5 torso-lengths for {t:.1f} s",
    "arm extension toward other torso; facing angle < 30° for {t:.1f} s",
    "rapid closing distance; limb-to-body intersection detected",
    "1 vs {n} group formation held for > 5 s; distance < 2 torso-lengths",
    "ring formation; {n} people within 3 torso-lengths; low motion variance",
    "sustained elevated motion variance; wrist jerk above threshold",
    "torso distance collapsed under 0.4 m; repeated strike motions",
    "aggressive posture change; crowd convergence rate exceeded 1.2 m/s",
]

ACTIONS = {
    "tense": "Monitor camera feed; alert roving guard to check sector",
    "fight_likely": "Dispatch nearest staff immediately to de-escalate",
    "fight": "Emergency intervention dispatch; notify campus security head",
    "calm": "Routine automated patrol log",
}

STATUSES = ["confirmed", "confirmed", "confirmed", "dismissed", "resolved"]


def _make_event(
    seq: int,
    cam_info: dict,
    dt: datetime,
    ev_type: str = "fight",
    level: str = "fight_likely",
    peak_score: float | None = None,
    people_count: int | None = None,
) -> dict:
    if peak_score is None:
        peak_score = round(random.uniform(0.65, 0.94), 2) if level != "calm" else round(random.uniform(0.1, 0.3), 2)
    if people_count is None:
        people_count = random.randint(2, 5) if ev_type != "crowd" else random.randint(5, 9)

    t_val = round(random.uniform(0.8, 3.2), 1)
    reason = random.choice(REASON_TEMPLATES).format(t=t_val, n=people_count)

    priority = compute_priority(level, peak_score, cam_info["risk"], people_count)
    action = ACTIONS.get(level, ACTIONS["tense"])

    start_iso = dt.isoformat()
    duration_secs = random.randint(30, 240)
    end_iso = (dt + timedelta(seconds=duration_secs)).isoformat()

    status = random.choice(STATUSES)
    pushed_to = cam_info["staff"] if level in ("fight_likely", "fight") else None
    pushed_at = (dt + timedelta(seconds=2)).isoformat() if pushed_to else None

    return {
        "incident_id": f"INC-2026-{seq:05d}",
        "camera_id": cam_info["camera_id"],
        "location": cam_info["location"],
        "zone_type": cam_info["zone_type"],
        "start_time": start_iso,
        "end_time": end_iso,
        "type": ev_type,
        "level": level,
        "peak_score": peak_score,
        "eta_seconds": random.randint(4, 9) if level in ("tense", "fight_likely") else None,
        "priority": priority,
        "reason": reason,
        "people_count": people_count,
        "action": action,
        "nearest_staff": cam_info["staff"],
        "pushed_to": pushed_to,
        "pushed_at": pushed_at,
        "status": status,
        "staff_note": "Reviewed by security team" if status == "confirmed" else None,
    }


def generate_seed_events() -> list[dict]:
    now = datetime.now(timezone.utc)
    events: list[dict] = []
    seq = 1

    cam_map = {c["camera_id"]: c for c in CAMERAS_CONFIG}

    # 1. Planted Pattern 1: Block C Stairwell — Mon-Thu 13:00-14:00 (5 incidents in last 4 weeks)
    stair_cam = cam_map["CAM-BLK-C1"]
    for w in range(4):
        # Pick Monday (0), Tuesday (1), Wednesday (2), or Thursday (3)
        dow = w % 4
        # Days ago
        days_ago = w * 7 + (now.weekday() - dow) % 7
        event_time = now - timedelta(days=days_ago)
        event_time = event_time.replace(hour=13, minute=random.randint(10, 50), second=random.randint(0, 59))
        events.append(_make_event(seq, stair_cam, event_time, ev_type="fight", level="fight_likely"))
        seq += 1
    # 5th one in the 4-week window
    extra_day = (now - timedelta(days=9)).replace(hour=13, minute=25, second=14)
    events.append(_make_event(seq, stair_cam, extra_day, ev_type="fight", level="fight"))
    seq += 1

    # Also add 3 older ones in weeks 5-8 for Block C stairwell to give strong 8w trend
    for w in range(5, 8):
        days_ago = w * 7 + random.randint(0, 3)
        event_time = (now - timedelta(days=days_ago)).replace(hour=13, minute=random.randint(5, 55))
        events.append(_make_event(seq, stair_cam, event_time, ev_type="fight", level="tense"))
        seq += 1

    # 2. Planted Pattern 2: Asrama Puteri Corridor — weeknights 22:00-00:00 (Hostel corridor)
    hostel_cam = cam_map["CAM-ASR-03"]
    for i in range(7):
        days_ago = random.randint(2, 26)
        hr = random.choice([22, 23])
        event_time = (now - timedelta(days=days_ago)).replace(hour=hr, minute=random.randint(0, 59))
        ev_type = "cornering" if i % 2 == 0 else "fight"
        events.append(_make_event(seq, hostel_cam, event_time, ev_type=ev_type, level="fight_likely"))
        seq += 1

    # 3. Planted Pattern 3: Car Park A — Friday 17:00-18:00
    car_cam = cam_map["CAM-CPK-01"]
    for w in range(1, 5):
        # find friday of that week
        friday_offset = (now.weekday() - 4) % 7
        days_ago = w * 7 + friday_offset
        event_time = (now - timedelta(days=days_ago)).replace(hour=17, minute=random.randint(10, 45))
        events.append(_make_event(seq, car_cam, event_time, ev_type="crowd", level="tense"))
        seq += 1

    # 4. Background noise: ~320 additional events spread across 8 weeks
    types_pool = ["fight", "fight", "cornering", "crowd", "play"]
    levels_pool = ["tense", "tense", "fight_likely", "fight", "calm"]

    for _ in range(330):
        cam = random.choice(CAMERAS_CONFIG)
        days_ago = random.uniform(0.1, 56.0)
        dt = now - timedelta(days=days_ago)

        ev_type = random.choice(types_pool)
        level = random.choice(levels_pool)
        if cam["zone_type"] == "sports_court" and ev_type == "fight":
            ev_type = "play"  # sports court usually play
            level = "calm"

        events.append(_make_event(seq, cam, dt, ev_type=ev_type, level=level))
        seq += 1

    # Sort events chronologically
    events.sort(key=lambda x: x["start_time"])
    return events


def seed():
    sb = get_supabase()
    print("Generating ~350 realistic 8-week events with planted hotspots...")
    events = generate_seed_events()
    print(f"Generated {len(events)} events.")

    print("Cleaning existing events table...")
    try:
        sb.table("events").delete().neq("incident_id", "").execute()
    except Exception as e:
        print(f"Note on delete: {e}")

    # Insert in batches of 100
    batch_size = 100
    for i in range(0, len(events), batch_size):
        batch = events[i : i + batch_size]
        print(f"Inserting batch {i//batch_size + 1} ({len(batch)} rows)...")
        sb.table("events").insert(batch).execute()

    print("✅ Seed history complete! Planted patterns ready for demo.")


if __name__ == "__main__":
    seed()
