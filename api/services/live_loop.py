"""
Pure helpers for the live loop (no FastAPI, no Supabase), so they can be unit-tested anywhere.

Contract rules (docs/earlyeye-TEAM-FINAL.md §6, approved 10 Oct 14:50):
- POST /events upserts by incident_id. The edge may set every field EXCEPT
  pushed_to, pushed_at, acked_at, status, staff_note; a repeat post never overwrites them.
- The API owns the push: on the first fight_likely / fight -> pushed_to = nearest_staff,
  pushed_at = now, status = pushed. The shift budget (3 per 8 h) caps fight_likely only;
  fight always pushes.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

HUMAN_FIELDS = ("pushed_to", "pushed_at", "acked_at", "status", "staff_note",
                "arrived_at", "outcome", "outcome_at")
NO_ANSWER_S = 20
SHIFT_HOURS = 8
PUSH_BUDGET = 3
LEVEL_ORDER = {"calm": 0, "tense": 1, "fight_likely": 2, "fight": 3}


def edge_fields(body: dict) -> dict:
    """What the edge may write: everything except the human / push fields."""
    return {k: v for k, v in body.items() if k not in HUMAN_FIELDS}


def merge_for_upsert(existing: dict | None, body: dict) -> dict:
    """Row to write for a POST. Keeps the stored human fields; never lowers a recorded peak."""
    row = edge_fields(body)
    if existing is None:
        row.setdefault("status", "new")
        return row
    for k in HUMAN_FIELDS:
        if k in existing:
            row[k] = existing[k]
    if existing.get("peak_score") is not None and row.get("peak_score") is not None:
        row["peak_score"] = max(float(existing["peak_score"]), float(row["peak_score"]))
    if existing.get("priority") is not None and row.get("priority") is not None:
        row["priority"] = max(float(existing["priority"]), float(row["priority"]))
    return row


def push_decision(row: dict, pushes_this_shift: int, staff_name: str | None, now_iso: str) -> dict:
    """Push fields to add, or {} when no push is due."""
    if row.get("pushed_to"):
        return {}
    if row.get("status") in ("confirmed", "dismissed", "resolved", "false_alarm"):
        return {}
    level = row.get("level")
    if level not in ("fight_likely", "fight"):
        return {}
    if level == "fight_likely" and pushes_this_shift >= PUSH_BUDGET:
        return {}
    name = staff_name or row.get("nearest_staff")
    if not name:
        return {}
    return {"pushed_to": name, "pushed_at": now_iso, "status": "pushed"}


def shift_start(now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    return (now - timedelta(hours=SHIFT_HOURS)).isoformat()


def patch_update(status: str | None, staff_note: str | None, acked_at: str | None,
                 arrived_at: str | None = None, outcome: str | None = None,
                 outcome_at: str | None = None, pushed_to: str | None = None,
                 pushed_at: str | None = None) -> dict:
    """PATCH body -> columns to update. The phone sends acked_at / arrived_at / outcome; the desk sends status."""
    out: dict = {}
    if arrived_at is not None:
        out["arrived_at"] = arrived_at
    if outcome is not None:
        out["outcome"] = outcome
    if outcome_at is not None:
        out["outcome_at"] = outcome_at
    if status is not None:
        out["status"] = status
    if staff_note is not None:
        out["staff_note"] = staff_note
    if acked_at is not None:
        out["acked_at"] = acked_at
    if pushed_to is not None:
        out["pushed_to"] = pushed_to
    if pushed_at is not None:
        out["pushed_at"] = pushed_at
    return out


def without_unknown_columns(row: dict, error_text: str) -> dict | None:
    """Supabase/PostgREST rejects a column that the table does not have yet (before the
    migration runs). Return the row without that column so the write can be retried, or None."""
    text = error_text or ""
    for col in ("acked_at", "arrived_at", "outcome", "outcome_at", "snapshot", "peak_snapshot", "top_features", "updated_at", "pushed_to", "pushed_at"):
        if col in row and col in text:
            r = dict(row)
            r.pop(col)
            return r
    return None


# ── Who gets the alarm (guard app) ───────────────────────────────────────────

def _guard_dist(target_geo: dict | None, post_geo: dict | None) -> float:
    if not target_geo or not post_geo:
        return float("inf")
    try:
        dlat = float(target_geo.get("lat", 0)) - float(post_geo.get("lat", 0))
        dlng = float(target_geo.get("lng", 0)) - float(post_geo.get("lng", 0))
        return dlat * dlat + dlng * dlng
    except (TypeError, ValueError):
        return float("inf")


def nearest_guard(staff: list[dict], preferred: str | None, zone_type: str | None,
                  camera_geo: dict | None = None, guard_posts: dict[str, dict] | None = None) -> str | None:
    """Find the geographically or zone-nearest guard regardless of on_duty, used for nearest_staff."""
    if not staff:
        return preferred
    guard_posts = guard_posts or {}
    # If geo is available, sort by distance to camera
    if camera_geo:
        def key(r):
            pos = guard_posts.get(r["name"]) or r.get("post")
            return (_guard_dist(camera_geo, pos), 0 if r.get("zone") == zone_type else 1)
        sorted_staff = sorted(staff, key=key)
        return sorted_staff[0]["name"]
    # Fallback to zone match
    for r in staff:
        if zone_type and r.get("zone") == zone_type:
            return r["name"]
    return preferred or (staff[0]["name"] if staff else None)


def choose_guard(staff: list[dict], preferred: str | None, zone_type: str | None,
                 exclude: tuple[str, ...] = (),
                 camera_geo: dict | None = None,
                 guard_posts: dict[str, dict] | None = None) -> str | None:
    """
    The person to push. Only people on duty (on_duty is not False: a guard who never tapped
    Start my shift still counts, so nobody is silently skipped). Preference: the edge's
    nearest_staff (if on duty), then someone based in this zone, then anyone on duty.
    If nobody is on duty, the edge's choice still gets it rather than nobody.
    """
    guard_posts = guard_posts or {}
    on = [r for r in staff if r.get("on_duty") is not False and r.get("name") not in exclude]
    names = [r["name"] for r in on]

    # If camera geo is provided, sort on-duty guards by distance to camera
    if camera_geo and on:
        def dist_key(r):
            pos = guard_posts.get(r["name"]) or r.get("post")
            dist = _guard_dist(camera_geo, pos)
            zone_match = 0 if (zone_type and r.get("zone") == zone_type) else 1
            pref_match = 0 if (preferred and r.get("name") == preferred) else 1
            return (dist, zone_match, pref_match)
        ranked = sorted(on, key=dist_key)
        return ranked[0]["name"]

    if preferred and preferred in names:
        return preferred
    for r in on:
        if zone_type and r.get("zone") == zone_type:
            return r["name"]
    if names:
        return names[0]
    return preferred if preferred and preferred not in exclude else None


def escalation_due(row: dict, now: datetime, backup_exists: bool) -> bool:
    """No "On my way" within 20 s of the push: send the next guard (once per incident)."""
    if backup_exists or str(row.get("incident_id", "")).endswith("-B"):
        return False
    if row.get("status") != "pushed" or not row.get("pushed_at") or row.get("acked_at"):
        return False
    if row.get("end_time"):
        return False
    try:
        pushed = datetime.fromisoformat(str(row["pushed_at"]).replace("Z", "+00:00"))
    except ValueError:
        return False
    if pushed.tzinfo is None:
        pushed = pushed.replace(tzinfo=timezone.utc)
    return (now - pushed).total_seconds() >= NO_ANSWER_S


BACKUP_SKIP = ("pushed_to", "pushed_at", "acked_at", "arrived_at", "outcome", "outcome_at",
               "staff_note", "status", "incident_id", "created_at", "updated_at", "id")


def backup_row(row: dict, staff: str, now_iso: str, why: str) -> dict:
    """A second incident on the same camera, pushed to the backup guard. id = <id>-B."""
    out = {k: v for k, v in row.items() if k not in BACKUP_SKIP}
    first = row.get("pushed_to") or "the first guard"
    out.update({
        "incident_id": f"{row['incident_id']}-B",
        "pushed_to": staff,
        "pushed_at": now_iso,
        "nearest_staff": staff,
        "status": "pushed",
        "action": f"Back up {first} at {row.get('location', 'the scene')}",
        "reason": f"{why} {row.get('reason', '')}".strip(),
    })
    return out
