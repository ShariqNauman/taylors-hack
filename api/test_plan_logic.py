"""Unit tests for api/services/plan_logic.py. Plain Python: python api/test_plan_logic.py (or pytest)."""
import importlib.util
import pathlib
import sys
from datetime import datetime, timedelta, timezone

_spec = importlib.util.spec_from_file_location(
    "plan_logic", pathlib.Path(__file__).with_name("services") / "plan_logic.py")
P = importlib.util.module_from_spec(_spec)
sys.modules["plan_logic"] = P  # dataclasses look the module up
_spec.loader.exec_module(P)
MYT = P.MYT
NOW = datetime(2026, 10, 10, 6, 30, tzinfo=MYT)


def ev(day, hour, loc="Sports pitch", status="confirmed"):
    t = datetime(2026, 9, day, hour, 10, tzinfo=MYT) if day > 10 else datetime(2026, 10, day, hour, 10, tzinfo=MYT)
    return {"location": loc, "zone_type": "sports_court", "start_time": t.isoformat(), "status": status}


def test_labels():
    assert P.days_label([0, 1, 2, 3]) == "Mon–Thu"
    assert P.days_label([6, 0, 1, 2, 3]) == "Sun–Thu"
    assert P.days_label([1, 3]) == "Tue, Thu"
    assert P.hours_label(17) == "17:00–18:00"


def test_check_due():
    assert P.last_check_due(NOW, None)
    assert P.last_check_due(NOW, NOW - timedelta(hours=2))          # 04:30 today, before 06:00
    assert not P.last_check_due(NOW, NOW - timedelta(minutes=10))   # 06:20 today
    early = datetime(2026, 10, 10, 5, 0, tzinfo=MYT)
    assert not P.last_check_due(early, datetime(2026, 10, 9, 6, 1, tzinfo=MYT))


def test_new_pattern_becomes_suggestion_only():
    events = [ev(15, 17), ev(24, 17), ev(8, 17), ev(8, 17, status="dismissed")]
    r = P.recheck([], events, NOW)
    assert len(r["add"]) == 1
    s = r["add"][0]
    assert s["status"] == "suggested" and s["hours"] == "17:00–18:00" and s["incidents_4w"] == 3
    assert s["days"] == "Tue, Thu"


def test_dismissed_and_old_do_not_count():
    events = [ev(15, 17), ev(24, 17, status="dismissed"), ev(8, 17)]
    assert P.recheck([], events, NOW)["add"] == []


def test_existing_post_is_not_suggested_again():
    slots = [{"id": "P4", "location": "Sports pitch", "hours": "17:00–18:00", "status": "active", "since": "2026-10-01T00:00:00+08:00"}]
    events = [ev(15, 17), ev(24, 17), ev(8, 17)]
    r = P.recheck(slots, events, NOW)
    assert r["add"] == [] and r["flag_end"] == []


def test_quiet_post_gets_end_suggestion_but_stays_active():
    slots = [{"id": "P1", "location": "Block C stairwell", "hours": "13:00–14:00", "status": "active", "since": "2026-09-01T00:00:00+08:00"}]
    r = P.recheck(slots, [ev(15, 13, loc="Block C stairwell")], NOW)   # last one 25 days ago
    assert r["flag_end"] == ["P1"]
    young = [{**slots[0], "since": "2026-10-05T00:00:00+08:00"}]      # younger than 14 days
    assert P.recheck(young, [], NOW)["flag_end"] == []


def test_ended_post_needs_new_incidents():
    events = [ev(15, 17), ev(24, 17), ev(8, 17)]
    ended = [{"id": "P4", "location": "Sports pitch", "hours": "17:00–18:00", "status": "ended",
              "ended_at": "2026-10-09T00:00:00+08:00"}]
    assert P.recheck(ended, events, NOW)["add"] == []
    ended[0]["ended_at"] = "2026-09-01T00:00:00+08:00"
    assert len(P.recheck(ended, events, NOW)["add"]) == 1


def test_slot_updates():
    cur = {"status": "suggested", "assigned_to": None}
    u = P.slot_update(cur, {"status": "active"}, NOW)
    assert u["status"] == "active" and u["since"] == NOW.isoformat() and u["suggestion"] is None
    u = P.slot_update({"status": "active", "assigned_to": "Guard B", "seen_at": "x"}, {"assigned_to": "Guard C"}, NOW)
    assert u == {"assigned_to": "Guard C", "seen_at": None}
    u = P.slot_update({"status": "active", "assigned_to": "Guard B"}, {"status": "ended"}, NOW)
    assert u["status"] == "ended" and u["assigned_to"] is None and u["ended_at"] == NOW.isoformat()


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
