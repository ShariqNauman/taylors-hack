"""
EarlyEye API — Standing guard posts.

GET   /plan                      → standing posts (active + suggested) with this week's check-ins.
                                   After 06:00 Malaysia time, the first call of the day runs the recheck.
POST  /plan/recheck              → run the recheck now (demo / cron).
POST  /plan/slots                → (+ Add a post) supervisor adds a manual standing post (Route 18).
PATCH /plan/slots/{id}           → {status, assigned_to, seen_at, days, hours, location, tip...} (Route 19 extended).
POST  /plan/slots/{id}/checkins  → {staff} the guard checked in at the post.

Rules (api/services/plan_logic.py): posts stay until the supervisor ends them. The recheck looks at
the last 28 days, adds new patterns as suggestions, and suggests ending posts quiet for 14 days.
It never changes an active post on its own.
"""

from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from api.db import get_supabase
from api.models import CheckinCreate, PatrolPlan, PatrolSlot, SlotCreate, SlotPatch
from api.routers.hotspots import get_plan as generated_plan
from api.services import plan_logic

router = APIRouter(prefix="", tags=["plan"])

_RECHECK_LOCK = threading.Lock()
_MEM_SLOTS: dict[str, dict] = {}
_MEM_CHECKINS: dict[str, list[dict]] = {}

SLOT_COLUMNS = (
    "id", "location", "zone_type", "days", "hours", "incidents_4w",
    "expected_avoided_per_week", "rationale", "status", "since", "assigned_to",
    "seen_at", "tip", "suggestion", "evidence", "ended_at", "source", "geo"
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _row(slot: dict) -> dict:
    return {k: slot.get(k) for k in SLOT_COLUMNS if k in slot}


def _next_id(slots: list[dict]) -> str:
    nums = [int(s["id"][1:]) for s in slots if str(s.get("id", "")).startswith("P") and s["id"][1:].isdigit()]
    return f"P{max(nums, default=0) + 1}"


def _load_slots(sb) -> list[dict]:
    try:
        db_slots = sb.table("plan_slots").select("*").execute().data or []
        if db_slots:
            for s in db_slots:
                _MEM_SLOTS[s["id"]] = s
            return db_slots
    except Exception:
        pass
    if _MEM_SLOTS:
        return list(_MEM_SLOTS.values())
    return []


def _seed(sb) -> list[dict]:
    """First call ever: the hotspot plan becomes the first standing posts."""
    now = _now().isoformat()
    rows = []
    for i, s in enumerate(generated_plan().slots, start=1):
        slot_dict = s.model_dump(include=set(SLOT_COLUMNS))
        r = {
            **slot_dict,
            "id": f"P{i}",
            "status": "active",
            "since": now,
            "source": "model",
            "evidence": [],
        }
        rows.append(r)
        _MEM_SLOTS[r["id"]] = r
    if rows:
        try:
            sb.table("plan_slots").insert(rows).execute()
        except Exception:
            pass
    return rows


def _last_check(sb) -> datetime | None:
    try:
        rows = sb.table("plan_meta").select("value").eq("key", "last_check").limit(1).execute().data
        return plan_logic.parse_ts(rows[0]["value"]) if rows else None
    except Exception:
        return None


def _real_events(sb, now: datetime) -> list[dict]:
    since = (now - timedelta(days=plan_logic.WINDOW_DAYS)).isoformat()
    try:
        return (
            sb.table("events").select("location,zone_type,start_time,status")
            .gte("start_time", since).in_("status", list(plan_logic.REAL)).execute().data or []
        )
    except Exception:
        return []


def _run_recheck(sb, slots: list[dict], now: datetime) -> list[dict]:
    with _RECHECK_LOCK:
        last = _last_check(sb)
        if last and not plan_logic.last_check_due(now, last):
            return _load_slots(sb)
        result = plan_logic.recheck(slots, _real_events(sb, now), now)
        for new in result["add"]:
            new["id"] = _next_id(slots)
            new.setdefault("source", "model")
            _MEM_SLOTS[new["id"]] = new
            try:
                sb.table("plan_slots").insert(_row(new)).execute()
            except Exception:
                pass
            slots.append(new)
        for sid in result["flag_end"]:
            if sid in _MEM_SLOTS:
                _MEM_SLOTS[sid]["suggestion"] = "end"
            try:
                sb.table("plan_slots").update({"suggestion": "end"}).eq("id", sid).execute()
            except Exception:
                pass
        for sid in result["clear_end"]:
            if sid in _MEM_SLOTS:
                _MEM_SLOTS[sid]["suggestion"] = None
            try:
                sb.table("plan_slots").update({"suggestion": None}).eq("id", sid).execute()
            except Exception:
                pass
        try:
            sb.table("plan_meta").upsert({"key": "last_check", "value": now.isoformat()}, on_conflict="key").execute()
        except Exception:
            pass
        return _load_slots(sb)


def _with_checkins(sb, slots: list[dict], now: datetime, keep_ended: bool = False) -> list[PatrolSlot]:
    since = (now - timedelta(days=7)).isoformat()
    rows = []
    try:
        rows = sb.table("plan_checkins").select("slot_id,staff,at").gte("at", since).execute().data or []
    except Exception:
        pass
    by_slot: dict[str, list[dict]] = {}
    for r in rows:
        by_slot.setdefault(r["slot_id"], []).append({"staff": r["staff"], "at": r["at"]})
    for sid, chks in _MEM_CHECKINS.items():
        by_slot.setdefault(sid, []).extend(chks)

    out = []
    for s in slots:
        if s.get("status") == "ended" and not keep_ended:
            continue
        clean = {k: v for k, v in s.items() if k in SLOT_COLUMNS and v is not None}
        clean.setdefault("source", "model")
        out.append(PatrolSlot(**clean, checkins=sorted(by_slot.get(s["id"], []), key=lambda c: c["at"])))
    order = {"active": 0, "suggested": 1}
    return sorted(out, key=lambda p: (order.get(p.status.value, 2), p.id or ""))


def _plan(force: bool) -> PatrolPlan:
    sb = get_supabase()
    now = _now()
    slots = _load_slots(sb)
    if not slots:
        slots = _seed(sb)
    last = _last_check(sb)
    if force or plan_logic.last_check_due(now, last):
        slots = _run_recheck(sb, slots, now)
        last = now
    return PatrolPlan(
        generated_at=now.isoformat(),
        slots=_with_checkins(sb, slots, now),
        last_check=last.isoformat() if last else None,
    )


@router.get("/plan", response_model=PatrolPlan)
def get_plan():
    return _plan(force=False)


@router.post("/plan/recheck", response_model=PatrolPlan)
def recheck_now():
    return _plan(force=True)


@router.post("/plan/slots", response_model=PatrolSlot, status_code=201)
def create_slot(body: SlotCreate):
    """
    Route 18: Plan "+ Add a post".
    Supervisor adds a manual post {location, zone_type, geo, days, hours, tip, assigned_to, source: "manual"}.
    Creates new slot with status="active", since=now.
    """
    sb = get_supabase()
    now = _now()
    slots = _load_slots(sb)
    if not slots:
        slots = _seed(sb)
    new_id = _next_id(slots)
    row = {
        "id": new_id,
        "location": body.location,
        "zone_type": body.zone_type,
        "days": body.days,
        "hours": body.hours,
        "incidents_4w": 0,
        "expected_avoided_per_week": 0.0,
        "rationale": f"Manual post added by supervisor at {body.location}.",
        "status": "active",
        "since": now.isoformat(),
        "assigned_to": body.assigned_to,
        "tip": body.tip,
        "source": body.source or "manual",
        "geo": body.geo,
        "evidence": [],
    }
    _MEM_SLOTS[new_id] = row
    try:
        sb.table("plan_slots").insert(_row(row)).execute()
    except Exception:
        pass
    return PatrolSlot(**row)


def _slot(sb, slot_id: str) -> dict:
    try:
        rows = sb.table("plan_slots").select("*").eq("id", slot_id).limit(1).execute().data
        if rows:
            _MEM_SLOTS[slot_id] = rows[0]
            return rows[0]
    except Exception:
        pass
    if slot_id in _MEM_SLOTS:
        return _MEM_SLOTS[slot_id]
    raise HTTPException(status_code=404, detail=f"Post {slot_id} not found")


@router.patch("/plan/slots/{slot_id}", response_model=PatrolSlot)
def patch_slot(slot_id: str, body: SlotPatch):
    """
    Route 19: Extended edit post. Accepts status, assigned_to, seen_at, days, hours, location, zone_type, geo, tip.
    Clears seen_at if hours or days change while a guard is assigned.
    """
    sb = get_supabase()
    current = _slot(sb, slot_id)
    patch = body.model_dump(include=body.model_fields_set, mode="json")
    if not patch:
        raise HTTPException(status_code=422, detail="Send at least one field to update.")
    update = plan_logic.slot_update(current, patch, _now())
    merged = {**current, **update}
    _MEM_SLOTS[slot_id] = merged
    try:
        sb.table("plan_slots").update(update).eq("id", slot_id).execute()
    except Exception:
        pass
    return _with_checkins(sb, [merged], _now(), keep_ended=True)[0]


@router.post("/plan/slots/{slot_id}/checkins", response_model=PatrolSlot, status_code=201)
def post_checkin(slot_id: str, body: CheckinCreate):
    sb = get_supabase()
    current = _slot(sb, slot_id)
    if current.get("status") != "active":
        raise HTTPException(status_code=409, detail="Only an active post takes check-ins.")
    entry = {"staff": body.staff, "at": body.at or _now().isoformat()}
    _MEM_CHECKINS.setdefault(slot_id, []).append(entry)
    try:
        sb.table("plan_checkins").insert({"slot_id": slot_id, "staff": body.staff,
                                          "at": entry["at"]}).execute()
    except Exception:
        pass
    return _with_checkins(sb, [current], _now())[0]
