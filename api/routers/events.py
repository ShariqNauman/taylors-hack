"""
EarlyEye API — Events router (the core incident pipeline).

POST /events                   → edge app creates or updates an incident (upsert by incident_id)
GET  /events                   → dashboard fetches recent (?since=updated_at) or 28 days of incidents
PATCH /events/{incident_id}    → staff confirms / dismisses / resolves / Push now / guard taps acked_at
POST /events/{incident_id}/backup → send backup to an incident
GET  /labels                   → training labels for the model team (Route 21)
POST /handover                 → shift handover brief for live dashboard (Route 15)
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from supabase import Client

from api.db import get_supabase
from api.models import (
    BackupRequest,
    Event,
    EventCreate,
    EventPatch,
    LabelRow,
    Status,
)
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
        pass
    return 0.5


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


_EVENT_OVERLAYS: dict[str, dict] = {}


def _to_event(row: dict) -> Event:
    inc_id = row.get("incident_id")
    if inc_id and inc_id in _EVENT_OVERLAYS:
        row = {**row, **_EVENT_OVERLAYS[inc_id]}
    return Event(**row)


def _write(sb: Client, row: dict, existing: bool) -> list:
    """Upsert / update an event, dropping columns the table does not have yet (pre-migration)."""
    inc_id = row.get("incident_id")
    for _ in range(6):
        try:
            if existing:
                q = sb.table("events").update(row).eq("incident_id", row["incident_id"])
            else:
                q = sb.table("events").upsert(row, on_conflict="incident_id")
            return q.execute().data or []
        except Exception as exc:
            # Store dropped human fields in overlay memory
            for col in ("acked_at", "arrived_at", "outcome", "outcome_at", "pushed_to", "pushed_at", "updated_at"):
                if col in row and row[col] is not None:
                    _EVENT_OVERLAYS.setdefault(inc_id, {})[col] = row[col]
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
        sb.table("cameras").insert({
            "camera_id": camera_id,
            "site_id": site[0]["site_id"],
            "location": location,
            "zone_type": zone_type,
            "online": True,
        }).execute()
    except Exception:
        pass


# ── POST /events (Route 7) ────────────────────────────────────────────────────

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

    # Shift push budget
    pushes = 0
    try:
        pushes = len(supabase.table("events").select("incident_id")
                     .gte("pushed_at", live_loop.shift_start()).execute().data or [])
    except Exception:
        pass

    # Look up camera geo
    cam_geo = None
    try:
        c_row = supabase.table("cameras").select("geo").eq("camera_id", body.camera_id).limit(1).execute().data
        if c_row and c_row[0].get("geo"):
            cam_geo = c_row[0]["geo"]
    except Exception:
        pass

    # Check active standing post positions (Rule 7: checked-in guard on active post)
    active_posts_geo = {}
    try:
        since_4h = (datetime.now(timezone.utc) - timedelta(hours=4)).isoformat()
        chks = supabase.table("plan_checkins").select("slot_id,staff,at").gte("at", since_4h).execute().data or []
        if chks:
            slots_rows = supabase.table("plan_slots").select("id,geo").eq("status", "active").execute().data or []
            slot_geo_map = {s["id"]: s.get("geo") for s in slots_rows if s.get("geo")}
            for c in chks:
                if c["staff"] not in active_posts_geo and c["slot_id"] in slot_geo_map:
                    active_posts_geo[c["staff"]] = slot_geo_map[c["slot_id"]]
    except Exception:
        pass

    staff_rows = _staff_rows(supabase)

    # Rule 2 & 7: pick nearest on-duty guard
    staff_name = live_loop.choose_guard(
        staff_rows, body.nearest_staff, body.zone_type,
        camera_geo=cam_geo, guard_posts=active_posts_geo
    )

    # Set nearest_staff (regardless of on-duty) if not already set
    nearest_person = live_loop.nearest_guard(
        staff_rows, body.nearest_staff, body.zone_type,
        camera_geo=cam_geo, guard_posts=active_posts_geo
    )
    if nearest_person and not row.get("nearest_staff"):
        row["nearest_staff"] = nearest_person

    # If nobody on duty, staff_name is None; push_decision leaves pushed_to empty
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
        pass
    return _to_event(stored)


# ── POST /events/{incident_id}/backup ─────────────────────────────────────────

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
    return _to_event(row)


# ── GET /events (Route 6) ─────────────────────────────────────────────────────

@router.get("/events", response_model=list[Event])
async def list_events(since: Optional[str] = Query(default=None)):
    """
    Fetch events for the dashboard (Route 6).

    • If *since* is provided: filter by updated_at > since (fallback to start_time > since),
      sorted by priority descending (most urgent first).
    • Without *since*: return the last 28 days of events (start_time >= 28 days ago),
      sorted by start_time descending (supporting Track record's 4-week window).
    """
    supabase = get_supabase()

    try:
        if since:
            try:
                resp = (
                    supabase.table("events")
                    .select("*")
                    .gt("updated_at", since)
                    .order("priority", desc=True)
                    .execute()
                )
            except Exception:
                # Pre-migration fallback
                resp = (
                    supabase.table("events")
                    .select("*")
                    .gt("start_time", since)
                    .order("priority", desc=True)
                    .execute()
                )
        else:
            twenty_eight_days_ago = (datetime.now(timezone.utc) - timedelta(days=28)).isoformat()
            resp = (
                supabase.table("events")
                .select("*")
                .gte("start_time", twenty_eight_days_ago)
                .order("start_time", desc=True)
                .limit(1000)
                .execute()
            )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Query failed: {exc}")

    return [_to_event(row) for row in (resp.data or [])]


# ── PATCH /events/{incident_id} (Route 8) ─────────────────────────────────────

@router.patch("/events/{incident_id}", response_model=Event)
async def patch_event(incident_id: str, body: EventPatch):
    """
    Route 8: Operator / Guard status updates.
    The desk sends status (+ staff_note) or pushed_to/pushed_at for Push now.
    The duty phone sends acked_at ("On my way"), arrived_at ("I'm here"),
    and outcome + outcome_at ("What did you find?").
    """
    supabase = get_supabase()
    update_data = live_loop.patch_update(
        body.status.value if body.status is not None else None,
        body.staff_note,
        body.acked_at,
        body.arrived_at,
        body.outcome.value if body.outcome is not None else None,
        body.outcome_at,
        pushed_to=body.pushed_to,
        pushed_at=body.pushed_at,
    )
    if not update_data:
        raise HTTPException(status_code=422, detail="Send status, staff_note, acked_at, arrived_at, outcome, or pushed_to/pushed_at.")
    update_data["incident_id"] = incident_id

    # Desk "Push now" (status pushed): record who and when, so the guard's phone rings.
    if update_data.get("status") == "pushed":
        if not update_data.get("pushed_to"):
            try:
                cur = supabase.table("events").select("*").eq("incident_id", incident_id).limit(1).execute().data
            except Exception:
                cur = []
            pref = cur[0].get("nearest_staff") if cur else None
            zt = cur[0].get("zone_type") if cur else None
            name = live_loop.choose_guard(_staff_rows(supabase), pref, zt)
            if name:
                update_data["pushed_to"] = name
        if not update_data.get("pushed_at"):
            update_data["pushed_at"] = datetime.now(timezone.utc).isoformat()

    try:
        data = _write(supabase, update_data, existing=True)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Update failed: {exc}")
    if not data:
        raise HTTPException(status_code=404, detail=f"Event {incident_id} not found")
    return _to_event(data[0])


# ── GET /labels (Route 21: Model Training Labels) ─────────────────────────────

@router.get("/labels", response_model=list[LabelRow])
async def get_labels(since: Optional[str] = Query(default=None)):
    """
    Route 21: Decided incidents for model retraining (keypoints only, never video).
    Fetches incidents where a decision was made (status confirmed, dismissed, resolved, or outcome exists).
    """
    supabase = get_supabase()
    rows = []
    try:
        q = supabase.table("events").select("incident_id, camera_id, start_time, level, peak_score, status, outcome, peak_snapshot")
        if since:
            q = q.gt("start_time", since)
        q = q.in_("status", ["confirmed", "dismissed", "resolved"]).order("start_time", desc=True).limit(1000)
        resp = q.execute()
        rows = resp.data or []
    except Exception:
        # Pre-migration fallback if outcome or peak_snapshot columns are not yet created
        try:
            q = supabase.table("events").select("incident_id, camera_id, start_time, level, peak_score, status")
            if since:
                q = q.gt("start_time", since)
            q = q.in_("status", ["confirmed", "dismissed", "resolved"]).order("start_time", desc=True).limit(1000)
            resp = q.execute()
            rows = resp.data or []
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Query failed: {exc}")

    return [
        LabelRow(
            incident_id=r["incident_id"],
            camera_id=r.get("camera_id") or "CAM-AU-01",
            start_time=r["start_time"],
            level=r.get("level", "tense"),
            peak_score=float(r.get("peak_score") or 0.0),
            status=r["status"],
            outcome=r.get("outcome"),
            peak_snapshot=r.get("peak_snapshot"),
        )
        for r in rows
    ]
