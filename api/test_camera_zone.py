"""Unit tests for PATCH /cameras/{id} validation. Plain Python: python api/test_camera_zone.py (or pytest)."""
import ast
import pathlib

# Load zone_change_error without importing the router (which needs Supabase settings).
_src = pathlib.Path(__file__).with_name("routers").joinpath("site.py").read_text()
_fn = next(n for n in ast.parse(_src).body if isinstance(n, ast.FunctionDef) and n.name == "zone_change_error")
_ns: dict = {}
exec(compile(ast.Module(body=[_fn], type_ignores=[]), "site.py", "exec"), _ns)
zone_change_error = _ns["zone_change_error"]

ZONES = ["hostel_corridor", "stairwell", "canteen", "auditorium", "sports_court"]


def test_known_zone_is_allowed():
    assert zone_change_error("sports_court", ZONES) is None


def test_unknown_zone_is_refused():
    err = zone_change_error("football", ZONES)
    assert err and "football" in err and "sports_court" in err


def test_empty_zone_is_refused():
    assert zone_change_error("  ", ZONES)


def test_no_zone_table_allows_any():
    assert zone_change_error("sports_court", []) is None


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
    print("ok")
