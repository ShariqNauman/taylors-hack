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

HUMAN_FIELDS = ("pushed_to", "pushed_at", "acked_at", "status", "staff_note")
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


def patch_update(status: str | None, staff_note: str | None, acked_at: str | None) -> dict:
    """PATCH body -> columns to update. The phone sends acked_at only; the desk sends status."""
    out: dict = {}
    if status is not None:
        out["status"] = status
    if staff_note is not None:
        out["staff_note"] = staff_note
    if acked_at is not None:
        out["acked_at"] = acked_at
    return out


def without_unknown_columns(row: dict, error_text: str) -> dict | None:
    """Supabase/PostgREST rejects a column that the table does not have yet (before the
    migration runs). Return the row without that column so the write can be retried, or None."""
    text = error_text or ""
    for col in ("acked_at", "snapshot", "peak_snapshot", "top_features", "updated_at"):
        if col in row and col in text:
            r = dict(row)
            r.pop(col)
            return r
    return None
