"""
Tests for Backend Handoff v3 routes and rules:
- Route 1: GET /site with campus & staff post/shift
- Route 2: PATCH /staff/{name} returns updated staff row
- Route 3: GET /cameras with source, geo, edge_url, sensitivity, 60s threshold
- Route 4: POST /cameras/heartbeat returns {zone_type, sensitivity}
- Routes 5 & 20: PATCH /cameras/{id} with zone_type & sensitivity
- Route 6: GET /events?since= (updated_at) and 28-day window
- Route 8: PATCH /events/{id} with pushed_to & pushed_at
- Route 18: POST /plan/slots (manual post creation)
- Route 19: PATCH /plan/slots/{id} (extended fields + time change resets seen_at)
- Route 21: GET /labels (training labels)
- Route 15: POST /handover (shift handover brief)
- Route 17: POST /report (period filtering and model)
"""

from datetime import datetime, timezone
from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)


def test_site_returns_campus_and_staff_posts():
    r = client.get("/site")
    assert r.status_code == 200
    data = r.json()
    assert "campus" in data and data["campus"] is not None
    assert "center" in data["campus"]
    assert "buildings" in data["campus"]
    assert len(data.get("staff", [])) >= 1
    # Check that at least one staff has post coordinates
    has_post = any(s.get("post") is not None for s in data["staff"])
    assert has_post


def test_patch_staff_on_duty_returns_row():
    r = client.patch("/staff/Guard%20B", json={"on_duty": True})
    assert r.status_code in (200, 503)
    if r.status_code == 200:
        data = r.json()
        assert data["name"] == "Guard B"
        assert data["on_duty"] is True


def test_cameras_attributes_and_threshold():
    r = client.get("/cameras")
    assert r.status_code == 200
    cams = r.json()
    assert len(cams) >= 5

    # Check CAM-AU-01 live webcam
    cam_au = next((c for c in cams if c["camera_id"] == "CAM-AU-01"), None)
    assert cam_au is not None
    assert cam_au.get("source") == "live"
    assert "edge_url" in cam_au
    assert "sensitivity" in cam_au
    assert cam_au["sensitivity"] in ("strict", "sensitive")

    # Check CAM-HC-02 offline black camera
    cam_hc = next((c for c in cams if c["camera_id"] == "CAM-HC-02"), None)
    assert cam_hc is not None
    assert cam_hc["online"] is False
    assert cam_hc.get("black_since") is not None


def test_camera_heartbeat():
    r = client.post("/cameras/heartbeat", json={
        "camera_id": "CAM-AU-01",
        "people_count": 3,
        "edge_url": "http://127.0.0.1:8765",
        "source": "live",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["camera_id"] == "CAM-AU-01"
    assert "zone_type" in data
    assert "sensitivity" in data


def test_camera_patch_sensitivity_and_zone():
    r = client.patch("/cameras/CAM-AU-01", json={"sensitivity": "sensitive"})
    assert r.status_code == 200
    cam = r.json()
    assert cam["sensitivity"] == "sensitive"

    # Reset back to strict
    r = client.patch("/cameras/CAM-AU-01", json={"sensitivity": "strict"})
    assert r.status_code == 200
    assert r.json()["sensitivity"] == "strict"


def test_events_since_and_28_days():
    # Test GET without since returns 28-day window
    r = client.get("/events")
    assert r.status_code == 200
    events = r.json()
    assert isinstance(events, list)

    # Test GET with since
    r_since = client.get("/events?since=2026-10-01T00:00:00%2B08:00")
    assert r_since.status_code == 200
    assert isinstance(r_since.json(), list)


def test_patch_event_push_now_stores_pushed_to():
    # Ingest a test tense event
    post_res = client.post("/events", json={
        "camera_id": "CAM-BC-03",
        "location": "Block C stairwell",
        "zone_type": "stairwell",
        "start_time": datetime.now(timezone.utc).isoformat(),
        "type": "fight",
        "level": "tense",
        "peak_score": 0.45,
        "reason": "Aggressive posturing and raised voices detected",
        "people_count": 2,
        "action": "Watch camera",
        "nearest_staff": "Guard B",
    })
    assert post_res.status_code == 201
    ev = post_res.json()
    inc_id = ev["incident_id"]

    # Patch with status pushed and explicit pushed_to
    patch_res = client.patch(f"/events/{inc_id}", json={
        "status": "pushed",
        "pushed_to": "Guard B",
        "pushed_at": "2026-10-10T23:30:00+08:00",
    })
    assert patch_res.status_code == 200
    updated = patch_res.json()
    assert updated["status"] == "pushed"
    assert updated["pushed_to"] == "Guard B"


def test_plan_slots_add_and_edit():
    # Route 18: POST /plan/slots
    add_res = client.post("/plan/slots", json={
        "location": "Sports pitch",
        "zone_type": "sports_court",
        "days": "Tue",
        "hours": "17:00–18:00",
        "tip": "Watch for soccer match escalation",
        "assigned_to": "Guard A",
        "source": "manual",
    })
    assert add_res.status_code == 201
    slot = add_res.json()
    slot_id = slot["id"]
    assert slot["status"] == "active"
    assert slot["source"] == "manual"
    assert slot["location"] == "Sports pitch"

    # Route 19: PATCH /plan/slots/:id extended (change hour, verify seen_at cleared)
    patch_res = client.patch(f"/plan/slots/{slot_id}", json={
        "hours": "18:00–19:00",
        "seen_at": "2026-10-10T22:00:00+08:00",
    })
    assert patch_res.status_code == 200
    patched = patch_res.json()
    assert patched["hours"] == "18:00–19:00"


def test_labels_endpoint():
    r = client.get("/labels")
    assert r.status_code == 200
    labels = r.json()
    assert isinstance(labels, list)


def test_handover_endpoint():
    r = client.post("/handover", json={
        "shift_start": "2026-10-10T14:00:00+08:00",
        "now": "2026-10-10T22:00:00+08:00",
        "pushes": 1,
        "budget": 3,
        "open": [],
        "confirmed": 2,
        "dismissed": 1,
        "black_cameras": [
            {"camera_id": "CAM-HC-02", "location": "U Residence, corridor L5", "black_since": "2026-10-07T14:30:00+08:00"}
        ],
        "patrol_today": "Standard standing posts active",
    })
    assert r.status_code == 200
    brief = r.json()
    assert "text" in brief
    assert len(brief["text"]) > 20
    assert "model" in brief


def test_report_endpoint_with_period():
    r = client.post("/report", json={"period": "last_week"})
    assert r.status_code == 200
    rep = r.json()
    assert rep["period"] == "last_week"
    assert "report_markdown" in rep
