"""Unit tests for api/services/live_loop.py. Plain Python: python api/test_live_loop.py (or pytest)."""
import importlib.util
import pathlib

_spec = importlib.util.spec_from_file_location(
    "live_loop", pathlib.Path(__file__).with_name("services") / "live_loop.py")
L = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(L)


def test_repeat_post_keeps_human_fields():
    stored = {"incident_id": "I1", "level": "fight", "peak_score": 0.9, "priority": 0.5,
              "status": "confirmed", "pushed_to": "Guard B", "pushed_at": "t1", "acked_at": "t2",
              "staff_note": "ok"}
    body = {"incident_id": "I1", "level": "tense", "peak_score": 0.6, "priority": 0.2,
            "status": "new", "pushed_to": None, "staff_note": None}
    row = L.merge_for_upsert(stored, body)
    assert row["status"] == "confirmed" and row["pushed_to"] == "Guard B" and row["acked_at"] == "t2"
    assert row["staff_note"] == "ok" and row["level"] == "tense"
    assert row["peak_score"] == 0.9 and row["priority"] == 0.5


def test_first_post_ignores_edge_push_fields():
    row = L.merge_for_upsert(None, {"incident_id": "I2", "level": "tense", "pushed_to": "X", "status": "confirmed"})
    assert "pushed_to" not in row and row["status"] == "new"


def test_push_rules():
    assert L.push_decision({"level": "tense"}, 0, "Guard B", "now") == {}
    assert L.push_decision({"level": "fight_likely"}, 0, "Guard B", "now")["pushed_to"] == "Guard B"
    assert L.push_decision({"level": "fight_likely"}, 3, "Guard B", "now") == {}      # budget
    assert L.push_decision({"level": "fight"}, 9, "Guard B", "now")["status"] == "pushed"  # fight always
    assert L.push_decision({"level": "fight", "pushed_to": "A"}, 0, "Guard B", "now") == {}
    assert L.push_decision({"level": "fight", "status": "dismissed"}, 0, "Guard B", "now") == {}
    assert L.push_decision({"level": "fight", "nearest_staff": "Guard C"}, 0, None, "now")["pushed_to"] == "Guard C"


def test_patch_and_unknown_columns():
    assert L.patch_update(None, None, "t") == {"acked_at": "t"}
    assert L.patch_update("confirmed", "n", None) == {"status": "confirmed", "staff_note": "n"}
    r = L.without_unknown_columns({"a": 1, "acked_at": "t"}, "Could not find the 'acked_at' column")
    assert r == {"a": 1}
    assert L.without_unknown_columns({"a": 1}, "other error") is None


def test_choose_guard_on_duty_only():
    staff = [{"name": "Guard A", "zone": "canteen", "on_duty": True},
             {"name": "Guard B", "zone": "stairwell", "on_duty": False},
             {"name": "Guard C", "zone": "stairwell", "on_duty": None}]
    assert L.choose_guard(staff, "Guard B", "stairwell") == "Guard C"   # B ended the shift
    assert L.choose_guard(staff, "Guard A", "stairwell") == "Guard A"   # edge's choice is on duty
    assert L.choose_guard(staff, None, "canteen") == "Guard A"
    assert L.choose_guard(staff, None, "stairwell", exclude=("Guard C",)) == "Guard A"
    assert L.choose_guard([{"name": "Guard B", "on_duty": False}], "Guard B", "x") == "Guard B"  # nobody on: still someone
    assert L.choose_guard([], None, "x") is None


def test_escalation_after_20_s_once():
    from datetime import datetime, timedelta, timezone
    now = datetime(2026, 10, 10, 6, 0, 30, tzinfo=timezone.utc)
    row = {"incident_id": "I1", "status": "pushed", "pushed_at": "2026-10-10T06:00:05+00:00", "end_time": None}
    assert L.escalation_due(row, now, backup_exists=False)
    assert not L.escalation_due(row, now, backup_exists=True)
    assert not L.escalation_due({**row, "acked_at": "x"}, now, False)
    assert not L.escalation_due({**row, "pushed_at": "2026-10-10T06:00:20+00:00"}, now, False)
    assert not L.escalation_due({**row, "incident_id": "I1-B"}, now, False)
    b = L.backup_row({**row, "location": "Grand Hall", "pushed_to": "Guard B", "acked_at": "t", "outcome": "backup",
                      "reason": "Shove."}, "Guard C", "now", "No answer from Guard B in 20 s.")
    assert b["incident_id"] == "I1-B" and b["pushed_to"] == "Guard C" and b["status"] == "pushed"
    assert "acked_at" not in b and "outcome" not in b and b["reason"].startswith("No answer")


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
