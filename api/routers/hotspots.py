"""
EarlyEye API — Hotspot & Patrol-Plan router.

GET /hotspots  → returns time/location clusters where incidents recur.
generate_plan_slots() → the first three posts, used once to seed plan_slots
                        (GET /plan and the standing posts live in api/routers/plan.py).

Aggregation is done in Python because supabase-py doesn't support
raw SQL GROUP BY.  We pull the last 8 weeks of elevated events and
group them by (location, zone_type, weekday, hour).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter

from api.db import get_supabase
from api.models import Hotspot, PatrolPlan, PatrolSlot

router = APIRouter(prefix="", tags=["analytics"])

# ── Day-of-week helpers ──────────────────────────────────────────────────────

_DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
# Supabase returns timestamps in UTC; days and hours are the site's local time (Malaysia, UTC+8).
_MYT = timezone(timedelta(hours=8))


def _local(dt: datetime) -> datetime:
    return dt.astimezone(_MYT) if dt.tzinfo else dt


def _days_to_range_str(days: list[int]) -> str:
    """Convert a sorted list of weekday ints (0=Mon) into a compact string.

    Examples
    --------
    [0, 1, 2, 3]  → 'Mon-Thu'
    [0, 2, 4]     → 'Mon, Wed, Fri'
    [4, 5]        → 'Fri-Sat'
    """
    if not days:
        return ""
    days = sorted(set(days))

    # Check if the days form a contiguous range
    if days == list(range(days[0], days[-1] + 1)):
        if len(days) == 1:
            return _DAY_ABBR[days[0]]
        return f"{_DAY_ABBR[days[0]]}–{_DAY_ABBR[days[-1]]}"

    # Non-contiguous → comma-separated
    return ", ".join(_DAY_ABBR[d] for d in days)


def _hours_to_range_str(hours: list[int]) -> str:
    """Convert a sorted list of hour ints into a compact time-range string.

    Examples
    --------
    [13, 14, 15]  → '13:00-16:00'
    [9]           → '09:00-10:00'
    """
    if not hours:
        return ""
    hours = sorted(set(hours))
    start = hours[0]
    end = hours[-1] + 1  # the range covers up to the end of the last hour
    return f"{start:02d}:00–{end:02d}:00"


# ── Core aggregation logic ───────────────────────────────────────────────────

def _fetch_elevated_events(weeks: int = 8) -> list[dict]:
    """Fetch events from the last *weeks* weeks with level ∈ {tense, fight_likely, fight}."""
    sb = get_supabase()
    cutoff = (datetime.utcnow() - timedelta(weeks=weeks)).isoformat()

    resp = (
        sb.table("events")
        .select("*")
        .gte("start_time", cutoff)
        .in_("level", ["tense", "fight_likely", "fight"])
        .execute()
    )
    return resp.data or []


def _build_hotspots(events: list[dict], min_count: int = 3) -> list[Hotspot]:
    """Group events by (location, zone_type, weekday, hour) and keep groups
    with at least *min_count* occurrences.  Returns a sorted list of Hotspot
    objects (highest count first).
    """
    # key → { count, last_seen }
    buckets: dict[tuple, dict] = defaultdict(lambda: {"count": 0, "last_seen": ""})

    for ev in events:
        try:
            # Parse ISO-formatted start_time (handles both 'Z' suffix and '+00:00')
            raw = ev["start_time"]
            # Replace trailing Z with +00:00 for fromisoformat compat (Python < 3.11)
            if raw.endswith("Z"):
                raw = raw[:-1] + "+00:00"
            dt = _local(datetime.fromisoformat(raw))
        except (KeyError, ValueError):
            continue  # skip malformed rows

        key = (ev["location"], ev["zone_type"], dt.weekday(), dt.hour)
        buckets[key]["count"] += 1

        # Track the most-recent occurrence
        iso = ev["start_time"]
        if iso > buckets[key]["last_seen"]:
            buckets[key]["last_seen"] = iso

    # Filter by minimum count and sort descending
    hotspots = [
        Hotspot(
            location=loc,
            zone_type=zt,
            weekday=wd,
            hour=hr,
            count=info["count"],
            last_seen=info["last_seen"],
        )
        for (loc, zt, wd, hr), info in buckets.items()
        if info["count"] >= min_count
    ]
    hotspots.sort(key=lambda h: h.count, reverse=True)
    return hotspots


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/hotspots", response_model=list[Hotspot])
def get_hotspots():
    """Return incident hotspots from the last 8 weeks.

    A hotspot is any (location, zone_type, weekday, hour) bucket that
    accumulated ≥ 3 elevated events.
    """
    events = _fetch_elevated_events(weeks=8)
    return _build_hotspots(events, min_count=3)


def get_plan() -> PatrolPlan:
    """Generate a patrol schedule from hotspot data (seeds the standing posts once).

    Strategy
    --------
    1. Aggregate hotspots by location.
    2. Pick the top-3 locations (by total incident count).
    3. For each location determine the recurring days & hours.
    4. Estimate avoided incidents assuming 60 % prevention rate.
    """
    # -- 1. Fetch the full 8-week window for hotspot detection ---------------
    events_8w = _fetch_elevated_events(weeks=8)
    hotspots = _build_hotspots(events_8w, min_count=3)

    # -- 2. Aggregate by location to rank them ------------------------------
    loc_agg: dict[str, dict] = defaultdict(
        lambda: {"total": 0, "days": set(), "hours": set()}
    )
    for h in hotspots:
        loc_agg[h.location]["total"] += h.count
        loc_agg[h.location]["days"].add(h.weekday)
        loc_agg[h.location]["hours"].add(h.hour)

    # Sort locations by total incident count (descending) and take top 3
    top_locations = sorted(loc_agg.items(), key=lambda x: x[1]["total"], reverse=True)[
        :3
    ]

    # -- 3. For each top location, count last-4-week incidents at those
    #        days/hours to compute expected avoided per week -----------------
    four_weeks_ago = (datetime.utcnow() - timedelta(weeks=4)).isoformat()

    slots: list[PatrolSlot] = []
    for loc, agg in top_locations:
        days_list = sorted(agg["days"])
        hours_list = sorted(agg["hours"])

        # Count incidents in the last 4 weeks at this location AND the
        # identified days/hours (subset of events_8w)
        incidents_4w = 0
        for ev in events_8w:
            if ev["location"] != loc:
                continue
            try:
                raw = ev["start_time"]
                if raw.endswith("Z"):
                    raw = raw[:-1] + "+00:00"
                dt = _local(datetime.fromisoformat(raw))
            except (KeyError, ValueError):
                continue
            if ev["start_time"] < four_weeks_ago:
                continue
            if dt.weekday() in agg["days"] and dt.hour in agg["hours"]:
                incidents_4w += 1

        # 60 % prevention assumption
        expected_avoided = round((incidents_4w / 4) * 0.6, 2) if incidents_4w else 0.0

        days_str = _days_to_range_str(days_list)
        hours_str = _hours_to_range_str(hours_list)

        rationale = (
            f"{loc} recorded {agg['total']} elevated incidents (8 wk) "
            f"concentrated on {days_str} between {hours_str}. "
            f"Last 4 weeks: {incidents_4w} incidents in those slots; "
            f"a patrol presence could avoid ≈{expected_avoided}/week."
        )

        slots.append(
            PatrolSlot(
                location=loc,
                days=days_str,
                hours=hours_str,
                incidents_4w=incidents_4w,
                expected_avoided_per_week=expected_avoided,
                rationale=rationale,
            )
        )

    return PatrolPlan(
        generated_at=datetime.utcnow().isoformat(),
        slots=slots,
        assumption=(
            "60% of hotspot incidents avoided when a person is present "
            "(stated, not measured)"
        ),
    )
