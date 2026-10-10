"""
End-to-end automated tests for EarlyEye API endpoints against live Supabase.
"""

from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)


def test_all():
    print("=== Testing /health ===")
    r = client.get("/health")
    print("Status:", r.status_code, r.json())
    assert r.status_code == 200

    print("\n=== Testing /site ===")
    r = client.get("/site")
    data = r.json()
    print("Site Name:", data.get("name"))
    print("Zone count:", len(data.get("zones", [])))
    assert r.status_code == 200
    assert data["name"] == "Taylor's Lakeside Campus"

    print("\n=== Testing /cameras ===")
    r = client.get("/cameras")
    cams = r.json()
    print("Camera count:", len(cams))
    assert len(cams) >= 5
    dead_cam = next((c for c in cams if c["camera_id"] == "CAM-ASR-05"), None)
    assert dead_cam is not None
    print(f"Dead camera demo check: CAM-ASR-05 online={dead_cam['online']}, black_since={dead_cam.get('black_since')}")

    print("\n=== Testing /events (GET) ===")
    r = client.get("/events")
    events = r.json()
    print(f"Fetched {len(events)} events (limit 50).")
    assert len(events) > 0
    top = events[0]
    print(f"Sample top event: {top['incident_id']} at {top['location']} [level={top['level']}, priority={top['priority']}]")

    print("\n=== Testing /hotspots ===")
    r = client.get("/hotspots")
    hotspots = r.json()
    print(f"Discovered {len(hotspots)} recurring hotspots (count >= 3).")
    for h in hotspots[:3]:
        print(f"  - {h['location']} (Day {h['weekday']}, Hour {h['hour']}:00): {h['count']} incidents")
    assert len(hotspots) > 0

    print("\n=== Testing /plan ===")
    r = client.get("/plan")
    plan = r.json()
    print(f"Generated {len(plan['slots'])} patrol recommendation slots:")
    for s in plan["slots"]:
        print(f"  * {s['location']} | {s['days']} {s['hours']} | Avoided/wk: ~{s['expected_avoided_per_week']}")
    assert len(plan["slots"]) > 0

    print("\n=== Testing /proof ===")
    r = client.get("/proof")
    proof = r.json()
    print(f"Proof status: note='{proof.get('note')}', AUC={proof.get('clip_auc')}, lead_time={proof.get('lead_time_s')}")
    assert proof.get("clip_auc") is not None

    print("\n=== Testing POST /events (Ingest alert from Edge) ===")
    test_event_payload = {
        "camera_id": "CAM-BLK-C1",
        "location": "Block C stairwell",
        "zone_type": "stairwell",
        "start_time": "2026-10-10T14:45:00+08:00",
        "type": "fight",
        "level": "fight_likely",
        "peak_score": 0.88,
        "eta_seconds": 6,
        "reason": "wrist speed spiked; distance dropped below 0.5 torso-lengths for 1.4 s",
        "people_count": 2,
        "action": "Send nearest warden (Warden B)",
        "nearest_staff": "Warden B",
    }
    r = client.post("/events", json=test_event_payload)
    print("POST /events status:", r.status_code)
    created = r.json()
    new_id = created["incident_id"]
    print(f"Created incident: {new_id} with priority={created['priority']}, pushed_to={created.get('pushed_to')}")
    assert r.status_code == 201
    assert created.get("pushed_to") == "Warden B"  # Two-tier alert auto-push verified!

    print("\n=== Testing PATCH /events/{id} (Operator confirm/dismiss) ===")
    r = client.patch(f"/events/{new_id}", json={"status": "confirmed", "staff_note": "Guard dispatched and confirmed."})
    print("PATCH status:", r.status_code)
    updated = r.json()
    print(f"Updated status: {updated['status']}, note: {updated['staff_note']}")
    assert r.status_code == 200
    assert updated["status"] == "confirmed"

    print("\n" + "=" * 50)
    print("[SUCCESS] ALL 8 CONTRACT ENDPOINTS TESTED AND VERIFIED 100% OPERATIONAL!")
    print("=" * 50)


if __name__ == "__main__":
    test_all()
