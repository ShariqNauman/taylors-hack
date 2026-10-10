"""
EarlyEye API — Events router (the core incident pipeline).

POST /events   → edge app creates a new incident
GET  /events   → dashboard fetches recent or filtered incidents
PATCH /events/{incident_id} → staff confirms / dismisses / resolves
"""

from __future__ import annotations

import random
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from supabase import Client

from api.db import get_supabase
from api.models import Event, EventCreate, EventPatch, Status

router = APIRouter(prefix="", tags=["events"])


# ── Helper functions ──────────────────────────────────────────────────────────


def compute_priority(
    level: str,
    peak_score: float,
    zone_risk: float,
    people_count: int,
) -> float:
    """
    Combine severity level, model confidence, zone risk, and crowd size
    into a single 0‒1 priority score used for dashboard sort‑order.
    """
    severity_map = {
        "calm": 0.0,
        "tense": 0.3,
        "fight_likely": 0.7,
        "fight": 1.0,
    }
    severity = severity_map.get(level, 0.0)
    people_factor = min(people_count / 5.0, 1.0)
    priority = severity * peak_score * zone_risk * (0.5 + 0.5 * people_factor)
    return round(min(priority, 1.0), 2)


def get_zone_risk(supabase: Client, zone_type: str) -> float:
    """Look up the risk weight for a zone_type from the zones table."""
    try:
        resp = (
            supabase.table("zones")
            .select("risk")
            .eq("zone_type", zone_type)
            .limit(1)
            .execute()
        )
        if resp.data:
            return float(resp.data[0]["risk"])
    except Exception:
        pass  # fall through to default
    return 0.5  # sensible default if zone not found


def get_nearest_staff(
    supabase: Client, zone_type: str
) -> tuple[str | None, str | None]:
    """
    Find the first available staff member assigned to *zone_type*.
    Returns (staff_id, name) or (None, None) if nobody is assigned.
    """
    try:
        resp = (
            supabase.table("staff")
            .select("staff_id, name")
            .eq("zone", zone_type)
            .limit(1)
            .execute()
        )
        if resp.data:
            row = resp.data[0]
            return row["staff_id"], row["name"]
    except Exception:
        pass
    return None, None


# ── Routes ────────────────────────────────────────────────────────────────────


@router.post("/events", response_model=Event, status_code=201)
async def create_event(body: EventCreate):
    """
    Receive an incident from the edge analyser, enrich it with zone risk
    and priority, optionally auto‑push to the nearest staff member, and
    persist it in Supabase.
    """
    supabase = get_supabase()
    now_iso = datetime.now(timezone.utc).isoformat()

    # 1. Generate incident_id if the edge app didn't supply one
    incident_id = body.incident_id or (
        f"INC-{datetime.now(timezone.utc).strftime('%Y')}-{random.randint(10000, 99999)}"
    )

    # 2. Look up zone risk
    zone_risk = get_zone_risk(supabase, body.zone_type)

    # 3. Compute priority if not provided by the caller
    priority = body.priority if body.priority is not None else compute_priority(
        body.level.value, body.peak_score, zone_risk, body.people_count
    )

    # 4. Two-tier alert logic
    pushed_to: str | None = None
    pushed_at: str | None = None
    status = body.status

    if body.level in (body.level.fight_likely, body.level.fight):
        # High-severity → auto-push to nearest staff
        staff_id, staff_name = get_nearest_staff(supabase, body.zone_type)
        if staff_name:
            pushed_to = staff_name
            pushed_at = now_iso
            status = Status.pushed
    # 'tense' and 'calm' stay as 'new' — no auto-push

    # 5. Touch the camera's last_frame_at timestamp
    try:
        supabase.table("cameras").update(
            {"last_frame_at": now_iso}
        ).eq("camera_id", body.camera_id).execute()
    except Exception:
        pass  # non-critical; don't fail the event creation

    # 6. Build the row and insert
    row = {
        "incident_id": incident_id,
        "camera_id": body.camera_id,
        "location": body.location,
        "zone_type": body.zone_type,
        "start_time": body.start_time,
        "end_time": body.end_time,
        "type": body.type.value,
        "level": body.level.value,
        "peak_score": body.peak_score,
        "eta_seconds": body.eta_seconds,
        "priority": priority,
        "reason": body.reason,
        "people_count": body.people_count,
        "action": body.action,
        "nearest_staff": body.nearest_staff,
        "pushed_to": pushed_to,
        "pushed_at": pushed_at,
        "status": status.value,
        "staff_note": body.staff_note,
    }

    try:
        resp = supabase.table("events").insert(row).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Insert failed: {exc}")

    if not resp.data:
        raise HTTPException(status_code=500, detail="Insert returned no data")

    # 7. Return the created event
    return Event(**resp.data[0])


@router.get("/events", response_model=list[Event])
async def list_events(since: Optional[str] = Query(default=None)):
    """
    Fetch events for the dashboard.

    • If *since* is provided, return events whose start_time is after that
      timestamp, sorted by priority descending (most urgent first).
    • Otherwise return the most recent 50 events by start_time.
    """
    supabase = get_supabase()

    try:
        if since:
            resp = (
                supabase.table("events")
                .select("*")
                .gt("start_time", since)
                .order("priority", desc=True)
                .execute()
            )
        else:
            resp = (
                supabase.table("events")
                .select("*")
                .order("start_time", desc=True)
                .limit(50)
                .execute()
            )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Query failed: {exc}")

    return [Event(**row) for row in (resp.data or [])]


@router.patch("/events/{incident_id}", response_model=Event)
async def patch_event(incident_id: str, body: EventPatch):
    """
    Update an event's status (and optionally add a staff note).
    Used by guards / admins to confirm, dismiss, or resolve incidents.
    """
    supabase = get_supabase()

    update_data: dict = {"status": body.status.value}
    if body.staff_note is not None:
        update_data["staff_note"] = body.staff_note

    try:
        resp = (
            supabase.table("events")
            .update(update_data)
            .eq("incident_id", incident_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Update failed: {exc}")

    if not resp.data:
        raise HTTPException(
            status_code=404,
            detail=f"Event {incident_id} not found",
        )

    return Event(**resp.data[0])
