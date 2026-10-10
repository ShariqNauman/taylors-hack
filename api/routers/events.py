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
from api.models import BackupRequest, Event, EventCreate, EventPatch, Status
from api.services import live_loop

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


def _staff_rows(sb: Client) -> list[dict]:
    """Team with on-duty state (on_duty arrives with migration_plan_guard.sql; missing = on duty)."""
    try:
        return sb.table("staff").select("*").execute().data or []
    except Exception:
        return []


def _send_backup(sb: Client, row: dict, staff_rows: list[dict], staff: str | None, why: str) -> dict | None:
    """Create (or replace) <id>-B pushed to the next guard on duty. Returns the stored row."""
    first = row.get("pushed_to")
    name = staff or live_loop.choose_guard(staff_rows, None, row.get("zone_type"),
                                           exclude=tuple(x for x in (first,) if x))
    if not name or name == first:
        return None
    backup = live_loop.backup_row(row, name, datetime.now(timezone.utc).isoformat(), why)
    data = _write(sb, backup, existing=False)
    return data[0] if data else None


# ── Routes ────────────────────────────────────────────────────────────────────


def _write(sb: Client, row: dict, existing: bool) -> list:
    """Upsert / update an event, dropping columns the table does not have yet (pre-migration)."""
    for _ in range(6):
        try:
            if existing:
                q = sb.table("events").update(row).eq("incident_id", row["incident_id"])
            else:
                q = sb.table("events").upsert(row, on_conflict="incident_id")
            return q.execute().data or []
        except Exception as exc:
            smaller = live_loop.without_unknown_columns(row, str(exc))
            if smaller is None:
                raise
            row = smaller
    return []


def _ensure_camera(sb: Client, camera_id: str, location: str, zone_type: str) -> None:
    """events.camera_id references cameras: register a new edge camera instead of failing."""
    try:
        if sb.table("cameras").select("camera_id").eq("camera_id", camera_id).limit(1).execute().data:
            return
        site = sb.table("sites").select("site_id").limit(1).execute().data
        if not site:
            return
        sb.table("cameras").insert({"camera_id": camera_id, "site_id": site[0]["site_id"],
                                    "location": location, "zone_type": zone_type,
                                    "online": True}).execute()
    except Exception:
        pass  # if this fails, the insert below reports the real error


@router.post("/events", response_model=Event, status_code=201)
async def create_event(body: EventCreate):
    """
    Edge -> API, every 0.5 s while level >= tense, same incident_id (contract §6).
    Upserts by incident_id. The edge never overwrites pushed_to / pushed_at / acked_at /
    status / staff_note. The API pushes on the first fight_likely or fight; the shift
    budget (3 per 8 h) caps fight_likely only, fight always pushes.
    """
    supabase = get_supabase()
    now_iso = datetime.now(timezone.utc).isoformat()

    incident_id = body.incident_id or (
        f"INC-{datetime.now(timezone.utc).strftime('%Y')}-{random.randint(10000, 99999)}"
    )
    zone_risk = get_zone_risk(supabase, body.zone_type)
    priority = body.priority if body.priority is not None else compute_priority(
        body.level.value, body.peak_score, zone_risk, body.people_count
    )

    incoming = body.model_dump(mode="json", exclude_none=False)
    incoming.update({"incident_id": incident_id, "priority": priority})
    for k in ("snapshot", "peak_snapshot", "top_features"):
        if incoming.get(k) is None:
            incoming.pop(k, None)

    try:
        found = supabase.table("events").select("*").eq("incident_id", incident_id).limit(1).execute().data
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Lookup failed: {exc}")
    existing = found[0] if found else None
    row = live_loop.merge_for_upsert(existing, incoming)

    # The API owns the push.
    pushes = 0
    try:
        pushes = len(supabase.table("events").select("incident_id")
                     .gte("pushed_at", live_loop.shift_start()).execute().data or [])
    except Exception:
        pass
    # Only someone on duty gets the alarm (guard app: Start my shift / End my shift).
    staff_rows = _staff_rows(supabase)
    staff_name = live_loop.choose_guard(staff_rows, body.nearest_staff, body.zone_type)
    if not staff_name:
        _, staff_name = get_nearest_staff(supabase, body.zone_type)
    row.update(live_loop.push_decision(row, pushes, staff_name, now_iso))

    if existing is None:
        _ensure_camera(supabase, body.camera_id, body.location, body.zone_type)
    try:
        supabase.table("cameras").update({"last_frame_at": now_iso}).eq("camera_id", body.camera_id).execute()
    except Exception:
        pass

    try:
        data = _write(supabase, row, existing is not None)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Write failed: {exc}")
    if not data:
        raise HTTPException(status_code=500, detail="Write returned no data")

    # No "On my way" 20 s after the push, while the edge still sees it: send the next guard once.
    stored = data[0]
    try:
        has_backup = bool(supabase.table("events").select("incident_id")
                          .eq("incident_id", f"{incident_id}-B").limit(1).execute().data)
        if live_loop.escalation_due(stored, datetime.now(timezone.utc), has_backup):
            _send_backup(supabase, stored, staff_rows, None,
                         f"No answer from {stored.get('pushed_to')} in {live_loop.NO_ANSWER_S} s.")
    except Exception:
        pass  # the desk still sees "No answer in 20 s" and can send someone
    return Event(**stored)


@router.post("/events/{incident_id}/backup", response_model=Event, status_code=201)
async def send_backup(incident_id: str, body: BackupRequest):
    """
    Desk: send another guard to an incident ("Need backup" from the guard's phone, or no
    answer). Creates <id>-B pushed to `staff`, or to the next guard on duty.
    """
    supabase = get_supabase()
    found = supabase.table("events").select("*").eq("incident_id", incident_id).limit(1).execute().data
    if not found:
        raise HTTPException(status_code=404, detail=f"Event {incident_id} not found")
    why = "Backup requested by the first guard." if body.reason == "need_backup" else \
        f"No answer from {found[0].get('pushed_to')}."
    row = _send_backup(supabase, found[0], _staff_rows(supabase), body.staff, why)
    if not row:
        raise HTTPException(status_code=409, detail="Nobody else is on duty.")
    return Event(**row)


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
    The desk sends status (+ staff_note): confirmed / dismissed / resolved, or pushed for an
    early push. The duty phone sends acked_at ("On my way"; response = acked_at - pushed_at),
    arrived_at ("I'm here") and outcome + outcome_at ("What did you find?").
    """
    supabase = get_supabase()
    update_data = live_loop.patch_update(
        body.status.value if body.status is not None else None, body.staff_note, body.acked_at,
        body.arrived_at, body.outcome.value if body.outcome is not None else None, body.outcome_at,
    )
    if not update_data:
        raise HTTPException(status_code=422, detail="Send status, staff_note, acked_at, arrived_at or outcome.")
    update_data["incident_id"] = incident_id
    # Desk "Push now" (status pushed): record who and when, so the guard's phone rings.
    if update_data.get("status") == "pushed":
        try:
            cur = supabase.table("events").select("*").eq("incident_id", incident_id).limit(1).execute().data
        except Exception:
            cur = []
        if cur and not cur[0].get("pushed_to"):
            name = live_loop.choose_guard(_staff_rows(supabase), cur[0].get("nearest_staff"), cur[0].get("zone_type"))
            if name:
                update_data["pushed_to"] = name
                update_data["pushed_at"] = datetime.now(timezone.utc).isoformat()
    try:
        data = _write(supabase, update_data, existing=True)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Update failed: {exc}")
    if not data:
        raise HTTPException(status_code=404, detail=f"Event {incident_id} not found")
    return Event(**data[0])
