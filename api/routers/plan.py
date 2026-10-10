"""
EarlyEye API — Standing guard posts.

GET   /plan                      → standing posts (active + suggested) with this week's check-ins.
                                   After 06:00 Malaysia time, the first call of the day runs the recheck.
POST  /plan/recheck              → run the recheck now (demo / cron).
PATCH /plan/slots/{id}           → {status} accept a suggestion, end a post; {assigned_to} pick a guard;
                                   {seen_at} the guard opened the post in their app.
POST  /plan/slots/{id}/checkins  → {staff} the guard checked in at the post.

Rules (api/services/plan_logic.py): posts stay until the supervisor ends them. The recheck looks at
the last 28 days, adds new patterns as suggestions, and suggests ending posts quiet for 14 days.
It never changes an active post on its own.

Before api/sql/migration_plan_guard.sql runs (no plan_slots table), GET /plan still answers with
posts generated from hotspots, and the write routes return 503.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from api.db import get_supabase
from api.models import CheckinCreate, PatrolPlan, PatrolSlot, SlotPatch
from api.routers.hotspots import get_plan as generated_plan
from api.services import plan_logic

router = APIRouter(prefix="", tags=["plan"])

SLOT_COLUMNS = ("id", "location", "zone_type", "days", "hours", "incidents_4w",
                "expected_avoided_per_week", "rationale", "status", "since", "assigned_to",
                "seen_at", "tip", "suggestion", "evidence", "ended_at")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _row(slot: dict) -> dict:
    return {k: slot.get(k) for k in SLOT_COLUMNS if k in slot}


def _next_id(slots: list[dict]) -> str:
    nums = [int(s["id"][1:]) for s in slots if str(s.get("id", "")).startswith("P") and s["id"][1:].isdigit()]
    return f"P{max(nums, default=0) + 1}"


def _load_slots(sb) -> list[dict]:
    return sb.table("plan_slots").select("*").execute().data or []


def _seed(sb) -> list[dict]:
    """First call ever: the hotspot plan becomes the first standing posts."""
    now = _now().isoformat()
    rows = []
    for i, s in enumerate(generated_plan().slots, start=1):
        rows.append({**s.model_dump(include=set(SLOT_COLUMNS)), "id": f"P{i}", "status": "active",
                     "since": now, "evidence": []})
    if rows:
        sb.table("plan_slots").insert(rows).execute()
    return rows


def _last_check(sb) -> datetime | None:
    rows = sb.table("plan_meta").select("value").eq("key", "last_check").limit(1).execute().data
    return plan_logic.parse_ts(rows[0]["value"]) if rows else None


def _real_events(sb, now: datetime) -> list[dict]:
    since = (now - timedelta(days=plan_logic.WINDOW_DAYS)).isoformat()
    return (sb.table("events").select("location,zone_type,start_time,status")
            .gte("start_time", since).in_("status", list(plan_logic.REAL)).execute().data or [])


def _run_recheck(sb, slots: list[dict], now: datetime) -> list[dict]:
    result = plan_logic.recheck(slots, _real_events(sb, now), now)
    for new in result["add"]:
        new["id"] = _next_id(slots)
        sb.table("plan_slots").insert(_row(new)).execute()
        slots.append(new)
    for sid in result["flag_end"]:
        sb.table("plan_slots").update({"suggestion": "end"}).eq("id", sid).execute()
    for sid in result["clear_end"]:
        sb.table("plan_slots").update({"suggestion": None}).eq("id", sid).execute()
    sb.table("plan_meta").upsert({"key": "last_check", "value": now.isoformat()}, on_conflict="key").execute()
    return _load_slots(sb)


def _with_checkins(sb, slots: list[dict], now: datetime, keep_ended: bool = False) -> list[PatrolSlot]:
    since = (now - timedelta(days=7)).isoformat()
    rows = sb.table("plan_checkins").select("slot_id,staff,at").gte("at", since).execute().data or []
    by_slot: dict[str, list[dict]] = {}
    for r in rows:
        by_slot.setdefault(r["slot_id"], []).append({"staff": r["staff"], "at": r["at"]})
    out = []
    for s in slots:
        if s.get("status") == "ended" and not keep_ended:
            continue
        clean = {k: v for k, v in s.items() if k in SLOT_COLUMNS and v is not None}
        out.append(PatrolSlot(**clean, checkins=sorted(by_slot.get(s["id"], []), key=lambda c: c["at"])))
    order = {"active": 0, "suggested": 1}
    return sorted(out, key=lambda p: (order.get(p.status.value, 2), p.id or ""))


def _plan(force: bool) -> PatrolPlan:
    sb = get_supabase()
    now = _now()
    try:
        slots = _load_slots(sb)
    except Exception:
        plan = generated_plan()              # migration not run yet
        for i, s in enumerate(plan.slots, start=1):
            s.id = f"P{i}"
        return plan
    if not slots:
        slots = _seed(sb)
    last = _last_check(sb)
    if force or plan_logic.last_check_due(now, last):
        slots = _run_recheck(sb, slots, now)
        last = now
    return PatrolPlan(generated_at=now.isoformat(), slots=_with_checkins(sb, slots, now),
                      last_check=last.isoformat() if last else None)


@router.get("/plan", response_model=PatrolPlan)
def get_plan():
    return _plan(force=False)


@router.post("/plan/recheck", response_model=PatrolPlan)
def recheck_now():
    return _plan(force=True)


def _slot(sb, slot_id: str) -> dict:
    try:
        rows = sb.table("plan_slots").select("*").eq("id", slot_id).limit(1).execute().data
    except Exception:
        raise HTTPException(status_code=503, detail="Run api/sql/migration_plan_guard.sql first.")
    if not rows:
        raise HTTPException(status_code=404, detail=f"Post {slot_id} not found")
    return rows[0]


@router.patch("/plan/slots/{slot_id}", response_model=PatrolSlot)
def patch_slot(slot_id: str, body: SlotPatch):
    sb = get_supabase()
    current = _slot(sb, slot_id)
    patch = body.model_dump(include=body.model_fields_set, mode="json")
    if not patch:
        raise HTTPException(status_code=422, detail="Send status, assigned_to or seen_at.")
    update = plan_logic.slot_update(current, patch, _now())
    sb.table("plan_slots").update(update).eq("id", slot_id).execute()
    return _with_checkins(sb, [{**current, **update}], _now(), keep_ended=True)[0]


@router.post("/plan/slots/{slot_id}/checkins", response_model=PatrolSlot, status_code=201)
def post_checkin(slot_id: str, body: CheckinCreate):
    sb = get_supabase()
    current = _slot(sb, slot_id)
    if current.get("status") != "active":
        raise HTTPException(status_code=409, detail="Only an active post takes check-ins.")
    sb.table("plan_checkins").insert({"slot_id": slot_id, "staff": body.staff,
                                      "at": body.at or _now().isoformat()}).execute()
    return _with_checkins(sb, [current], _now())[0]
