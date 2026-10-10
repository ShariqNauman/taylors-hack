"""
Pure logic for standing guard posts (no FastAPI, no Supabase), unit-tested in api/test_plan_logic.py.

Team rules (docs/kayla-frontend-plan.md, handoff v3):
- Posts are standing: an active post stays until the supervisor ends it.
- Every day at 06:00 (Malaysia time) EarlyEye rechecks the last 28 days with the hotspot rule:
  3 or more REAL incidents (confirmed or resolved) at the same place and the same hour of day.
- New patterns become suggestions (status "suggested", suggestion "add").
- An active post with no real incident at its place and hour for 14 days gets suggestion "end".
- The recheck never changes an active post's status, hours, days or guard on its own.
- An ended post (or a suggestion answered "Not now") comes back only if 3 new incidents happen
  after it was ended.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

MYT = timezone(timedelta(hours=8))
WINDOW_DAYS = 28
QUIET_DAYS = 14
MIN_REAL = 3
CHECK_HOUR = 6
REAL = ("confirmed", "resolved")
DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def parse_ts(iso: str) -> datetime:
    raw = iso[:-1] + "+00:00" if iso.endswith("Z") else iso
    dt = datetime.fromisoformat(raw)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def days_label(days: list[int]) -> str:
    """[0,1,2,3] → 'Mon–Thu', [1,3] → 'Tue, Thu', [6,0,1,2,3] → 'Sun–Thu'."""
    d = sorted(set(days))
    if not d:
        return ""
    if len(d) == 1:
        return DAY_ABBR[d[0]]
    # contiguous, also across the week end (Sun–Thu)
    for start in d:
        run = [(start + i) % 7 for i in range(len(d))]
        if sorted(run) == d:
            return f"{DAY_ABBR[run[0]]}–{DAY_ABBR[run[-1]]}"
    return ", ".join(DAY_ABBR[x] for x in d)


def hours_label(hour: int) -> str:
    return f"{hour % 24:02d}:00–{(hour + 1) % 24:02d}:00"


def last_check_due(now: datetime, last_check: datetime | None) -> bool:
    """True when the most recent 06:00 MYT has passed since the last check."""
    local = now.astimezone(MYT)
    today_6 = local.replace(hour=CHECK_HOUR, minute=0, second=0, microsecond=0)
    due_at = today_6 if local >= today_6 else today_6 - timedelta(days=1)
    return last_check is None or last_check.astimezone(MYT) < due_at


@dataclass
class Pattern:
    location: str
    zone_type: str
    hour: int
    days: list[int]
    dates: list[str] = field(default_factory=list)  # ISO start times behind it

    @property
    def count(self) -> int:
        return len(self.dates)


def find_patterns(events: list[dict], now: datetime) -> list[Pattern]:
    """Real incidents in the last 28 days grouped by (place, hour); keep groups with >= 3."""
    since = now - timedelta(days=WINDOW_DAYS)
    groups: dict[tuple[str, int], Pattern] = {}
    for e in events:
        if e.get("status") not in REAL:
            continue
        try:
            t = parse_ts(e["start_time"])
        except (KeyError, ValueError):
            continue
        if t < since or t > now:
            continue
        local = t.astimezone(MYT)
        key = (e["location"], local.hour)
        p = groups.setdefault(key, Pattern(e["location"], e.get("zone_type", ""), local.hour, []))
        p.dates.append(e["start_time"])
        if local.weekday() not in p.days:
            p.days.append(local.weekday())
    out = [p for p in groups.values() if p.count >= MIN_REAL]
    for p in out:
        p.days.sort()
        p.dates.sort()
    return sorted(out, key=lambda p: -p.count)


def slot_hour(slot: dict) -> int | None:
    h = slot.get("hours", "")
    try:
        return int(h.split(":")[0])
    except (ValueError, AttributeError):
        return None


def recheck(slots: list[dict], events: list[dict], now: datetime) -> dict:
    """
    One daily check. Returns {"add": [new suggested slots], "flag_end": [ids], "clear_end": [ids]}.
    Never touches an active post except to set or clear its "suggest ending" flag.
    """
    patterns = find_patterns(events, now)
    live = [s for s in slots if s.get("status") in ("active", "suggested")]
    covered = {(s["location"], slot_hour(s)) for s in live}
    ended_at: dict[tuple, datetime] = {}
    for s in slots:
        if s.get("status") == "ended" and s.get("ended_at"):
            key = (s["location"], slot_hour(s))
            t = parse_ts(s["ended_at"])
            ended_at[key] = max(t, ended_at.get(key, t))
    add = []
    for p in patterns:
        key = (p.location, p.hour)
        if key in covered:
            continue
        if key in ended_at:
            p.dates = [d for d in p.dates if parse_ts(d) > ended_at[key]]
            if p.count < MIN_REAL:
                continue
            p.days = sorted({parse_ts(d).astimezone(MYT).weekday() for d in p.dates})
        add.append({
            "location": p.location,
            "zone_type": p.zone_type,
            "days": days_label(p.days),
            "hours": hours_label(p.hour),
            "incidents_4w": p.count,
            "expected_avoided_per_week": round(p.count * 0.6 / 4, 2),
            "status": "suggested",
            "suggestion": "add",
            "since": now.isoformat(),
            "rationale": f"{p.count} real incidents at {p.location} between {hours_label(p.hour).replace('–', ' and ')} in the last 28 days.",
            "evidence": p.dates,
        })
    quiet_since = now - timedelta(days=QUIET_DAYS)
    flag_end, clear_end = [], []
    for s in slots:
        if s.get("status") != "active":
            continue
        h = slot_hour(s)
        recent = [
            e for e in events
            if e.get("status") in REAL and e.get("location") == s["location"]
            and _hour_of(e) == h and _after(e, quiet_since, now)
        ]
        started = s.get("since")
        old_enough = not started or parse_ts(started) <= quiet_since
        if not recent and old_enough:
            if s.get("suggestion") != "end":
                flag_end.append(s["id"])
        elif s.get("suggestion") == "end":
            clear_end.append(s["id"])
    return {"add": add, "flag_end": flag_end, "clear_end": clear_end}


def _hour_of(e: dict) -> int | None:
    try:
        return parse_ts(e["start_time"]).astimezone(MYT).hour
    except (KeyError, ValueError):
        return None


def _after(e: dict, since: datetime, now: datetime) -> bool:
    try:
        t = parse_ts(e["start_time"])
    except (KeyError, ValueError):
        return False
    return since <= t <= now


SLOT_PATCH_FIELDS = ("status", "assigned_to", "seen_at", "suggestion")


def slot_update(current: dict, patch: dict, now: datetime) -> dict:
    """
    Columns to write for PATCH /plan/slots/:id.
    - Accepting a suggestion (suggested → active) starts the post: since = now, suggestion cleared.
    - Ending a post (or "Not now" on a suggestion): status ended, guard removed, ended_at = now.
    - A new guard resets seen_at (the post must be seen again in their app).
    """
    out: dict = {}
    status = patch.get("status")
    if status:
        out["status"] = status
        if status == "active" and current.get("status") != "active":
            out["since"] = now.isoformat()
            out["suggestion"] = None
        if status == "ended":
            out["assigned_to"] = None
            out["suggestion"] = None
            out["ended_at"] = now.isoformat()
    if "assigned_to" in patch:
        out["assigned_to"] = patch["assigned_to"]
        if patch["assigned_to"] != current.get("assigned_to"):
            out["seen_at"] = None
    if patch.get("seen_at"):
        out["seen_at"] = patch["seen_at"]
    return out
