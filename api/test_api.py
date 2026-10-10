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

    # ── ADVANCED FEATURES (SHOULD & CUT LIST) ─────────────────────────────────

    print("\n=== Testing POST /report (SHOULD #8: Executive Report) ===")
    r = client.post("/report", json={"period": "last_week", "language": "bilingual"})
    print("Report status:", r.status_code)
    rep = r.json()
    print(f"Report for {rep['period']} generated: {rep['total_incidents']} total incidents, cited {len(rep['cited_incident_ids'])} IDs")
    assert r.status_code == 200
    assert rep["total_incidents"] > 0
    assert len(rep["report_markdown"]) > 50

    print("\n=== Testing GET & POST /knowledge (CUT #1: pgvector & RAG) ===")
    r = client.get("/knowledge")
    k_docs = r.json()
    print("Knowledge docs count:", len(k_docs))
    assert r.status_code == 200
    assert len(k_docs) >= 5

    r = client.post("/knowledge/search", json={"query": "Seksyen 507 hukuman buli fizikal asrama", "limit": 2})
    search_res = r.json()
    print("Search results count:", len(search_res))
    assert r.status_code == 200
    assert len(search_res) > 0
    print(f"Top RAG Match: '{search_res[0]['title']}' (similarity: {search_res[0].get('similarity')})")

    print("\n=== Testing POST /agent/chat (CUT #2: AI Agent Tool Loop) ===")
    r = client.post("/agent/chat", json={"message": "Any dead or offline cameras currently on site? What is the SOP?"})
    agent_res = r.json()
    print("Agent status:", r.status_code)
    print("Agent tool calls executed:", [tc["tool"] for tc in agent_res["tool_calls"]])
    print(f"Agent response snippet:\n{agent_res['response'][:250]}...")
    assert r.status_code == 200
    assert len(agent_res["tool_calls"]) > 0

    print("\n=== Testing POST /notifications/dispatch (CUT #4: Notification Sending) ===")
    r = client.post(
        "/notifications/dispatch",
        json={
            "incident_id": new_id,
            "recipient_name": "Warden B",
            "recipient_contact": "0123456789",
            "channel": "whatsapp",
        },
    )
    notif = r.json()
    print("Notification status:", r.status_code)
    print(f"WhatsApp URL: {notif.get('whatsapp_url')[:60]}...")
    assert r.status_code == 200
    assert "https://wa.me/" in notif.get("whatsapp_url", "")

    print("\n=== Testing POST & GET /events/{id}/clip (CUT #5: 10s Clip Storage) ===")
    r = client.post(
        f"/events/{new_id}/clip",
        params={"clip_url": f"https://storage.earlyeye.internal/clips/{new_id}.mp4", "camera_id": "CAM-BLK-C1"},
    )
    clip_res = r.json()
    print("Clip upload status:", r.status_code)
    assert r.status_code == 200

    r = client.get(f"/events/{new_id}/clip")
    assert r.status_code == 200
    print("Clip fetch verified:", r.json()["clip_url"])

    print("\n=== Testing GET /sites (CUT #6: Multi-Site Catalog) ===")
    r = client.get("/sites")
    sites_list = r.json()
    print(f"Available sites: {[s['name'] for s in sites_list]}")
    assert r.status_code == 200
    assert len(sites_list) >= 3

    print("\n=== Testing POST /auth/login (CUT #7: Auth & Roles) ===")
    r = client.post("/auth/login", json={"username": "operator", "password": "password123"})
    print("Login status:", r.status_code)
    auth_data = r.json()
    token = auth_data["access_token"]
    print(f"Authenticated as: {auth_data['user']['full_name']} ({auth_data['user']['role']})")
    assert r.status_code == 200
    assert token is not None

    r = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    print("Verified /auth/me for:", r.json()["username"])

    print("\n" + "=" * 50)
    print("[SUCCESS] ALL CORE (MUST) + ADVANCED (CUT/SHOULD) ENDPOINTS VERIFIED 100% OPERATIONAL!")
    print("=" * 50)


if __name__ == "__main__":
    test_all()
