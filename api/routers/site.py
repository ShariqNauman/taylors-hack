"""
EarlyEye API — Site & Camera router.

GET   /site                    → returns the demo site with its zones, team (staff with post & shift), and 3D campus.
PATCH /staff/{name}            → guard app: Start / End my shift; returns the staff row.
GET   /cameras                 → returns all cameras with computed online / black_since status and edge/geo attributes.
POST  /cameras/heartbeat       → camera health probe from edge every 10 s; returns {zone_type, sensitivity}.
PATCH /cameras/{camera_id}     → manager changes camera's zone_type and/or sensitivity ('strict' | 'sensitive').
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from api.db import get_supabase
from api.models import (
    Camera,
    CameraHeartbeat,
    CameraHeartbeatResponse,
    CameraPatch,
    CampusInfo,
    GeoPoint,
    Site,
    SiteStaff,
    StaffDuty,
    StaffShift,
    Zone,
)

router = APIRouter(prefix="", tags=["site"])

# ── Seed Defaults (mirrors web/public/mock for the Taylor's Lakeside pilot) ──

_STAFF_DEFAULT_POSTS: dict[str, dict] = {
    "Guard B": {"lat": 3.0642137, "lng": 101.6170619},
    "Guard A": {"lat": 3.0631104, "lng": 101.6163152},
    "Guard C": {"lat": 3.06406, "lng": 101.6165401},
}

_CAMPUS_DEFAULT: dict = {
    "center": {"lat": 3.0631104, "lng": 101.6169899},
    "buildings": "/campus/taylors-lakeside-campus.geojson",
}

_CAMERA_DEFAULTS: dict[str, dict] = {
    "CAM-AU-01": {
        "location": "Grand Hall",
        "zone_type": "auditorium",
        "source": "live",
        "edge_url": "http://127.0.0.1:8765",
        "people_count": 2,
        "geo": {
            "lat": 3.0645574,
            "lng": 101.6170349,
            "alt_m": 10,
            "building": "Block B",
            "floor": "level 2, stage left",
        },
    },
    "CAM-BC-03": {
        "location": "Block C stairwell",
        "zone_type": "stairwell",
        "source": "recorded",
        "edge_url": "http://127.0.0.1:8766",
        "recorded_at": "2026-10-10T16:20:00+08:00",
        "people_count": 1,
        "geo": {
            "lat": 3.0640871,
            "lng": 101.6175477,
            "alt_m": 8,
            "building": "Block C",
            "floor": "level 1 landing",
        },
    },
    "CAM-CT-04": {
        "location": "Syopz Mall food court",
        "zone_type": "canteen",
        "source": "recorded",
        "edge_url": "http://127.0.0.1:8767",
        "recorded_at": "2026-10-10T16:35:00+08:00",
        "people_count": 14,
        "geo": {
            "lat": 3.0638158,
            "lng": 101.6164681,
            "alt_m": 8,
            "building": "Syopz Mall",
            "floor": "east entrance",
        },
    },
    "CAM-HC-01": {
        "location": "U Residence, corridor L3",
        "zone_type": "hostel_corridor",
        "source": "recorded",
        "edge_url": "http://127.0.0.1:8768",
        "recorded_at": "2026-10-10T16:50:00+08:00",
        "people_count": 1,
        "geo": {
            "lat": 3.0642137,
            "lng": 101.6160904,
            "alt_m": 16,
            "building": "U Residence, above Syopz Mall",
            "floor": "residence level 3",
        },
    },
    "CAM-HC-02": {
        "location": "U Residence, corridor L5",
        "zone_type": "hostel_corridor",
        "source": "recorded",
        "online": False,
        "black_since": "2026-10-07T14:30:00+08:00",
        "people_count": 0,
        "edge_url": "",
        "geo": {
            "lat": 3.0643042,
            "lng": 101.6162883,
            "alt_m": 22,
            "building": "U Residence, above Syopz Mall",
            "floor": "residence level 5",
        },
    },
    "CAM-SC-06": {
        "location": "Sports pitch",
        "zone_type": "sports_court",
        "source": "recorded",
        "edge_url": "http://127.0.0.1:8769",
        "recorded_at": "2026-10-10T17:05:00+08:00",
        "people_count": 6,
        "geo": {
            "lat": 3.0617539,
            "lng": 101.6172328,
            "alt_m": 8,
            "building": "Sports centre",
            "floor": "football pitch side",
        },
    },
}

_CAMERA_RUNTIME: dict[str, dict] = {}


# ── GET /site ─────────────────────────────────────────────────────────────────

@router.get("/site", response_model=Site)
async def get_site() -> Site:
    """
    Return the single demo site with its zones, staff (with post & shift), and 3D campus layout.
    """
    sb = get_supabase()

    site_resp = sb.table("sites").select("*").limit(1).execute()
    if not site_resp.data:
        raise HTTPException(status_code=404, detail="No site found.")

    site_row = site_resp.data[0]

    zones_resp = (
        sb.table("zones")
        .select("*")
        .eq("site_id", site_row["site_id"])
        .execute()
    )

    zones = [
        Zone(
            zone_type=z["zone_type"],
            label=z["label"],
            risk=z["risk"],
        )
        for z in (zones_resp.data or [])
    ]

    campus = CampusInfo(
        center=GeoPoint(**_CAMPUS_DEFAULT["center"]),
        buildings=_CAMPUS_DEFAULT["buildings"],
    )

    return Site(
        site_id=site_row["site_id"],
        name=site_row["name"],
        site_type=site_row["site_type"],
        zones=zones,
        staff=_staff(sb, site_row["site_id"]),
        campus=campus,
    )


def _staff(sb, site_id: str) -> list[SiteStaff]:
    """The team for the Plan page and the guard app. name stays the call sign ("Guard B");
    display_name, photo_url and shift come from api/sql/migration_plan_guard.sql."""
    try:
        rows = sb.table("staff").select("*").eq("site_id", site_id).execute().data or []
    except Exception:
        return []
    out = []
    for r in rows:
        name = r["name"]
        shift = r.get("shift")
        try:
            shift = StaffShift(**shift) if isinstance(shift, dict) else None
        except Exception:
            shift = None
        post_geo = r.get("post") or _STAFF_DEFAULT_POSTS.get(name)
        post = GeoPoint(**post_geo) if post_geo else None
        out.append(
            SiteStaff(
                name=name,
                display_name=r.get("display_name"),
                photo_url=r.get("photo_url"),
                role=r.get("role"),
                zone_type=r.get("zone"),
                shift=shift,
                on_duty=r.get("on_duty"),
                post=post,
            )
        )
    return out


# ── PATCH /staff/{name} ──────────────────────────────────────────────────────

@router.patch("/staff/{name}", response_model=SiteStaff)
async def set_on_duty(name: str, body: StaffDuty) -> SiteStaff:
    """Guard app: Start my shift (true) / End my shift (false). Returns the updated staff row."""
    sb = get_supabase()
    try:
        rows = sb.table("staff").update({"on_duty": body.on_duty}).eq("name", name).execute().data
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Run api/sql/migration_plan_guard.sql first ({exc})")
    if not rows:
        raise HTTPException(status_code=404, detail=f"No staff member called {name}")
    r = rows[0]
    shift = r.get("shift")
    try:
        shift = StaffShift(**shift) if isinstance(shift, dict) else None
    except Exception:
        shift = None
    post_geo = r.get("post") or _STAFF_DEFAULT_POSTS.get(name)
    post = GeoPoint(**post_geo) if post_geo else None
    return SiteStaff(
        name=r["name"],
        display_name=r.get("display_name"),
        photo_url=r.get("photo_url"),
        role=r.get("role"),
        zone_type=r.get("zone"),
        shift=shift,
        on_duty=r.get("on_duty"),
        post=post,
    )


# ── GET /cameras ──────────────────────────────────────────────────────────────

@router.get("/cameras", response_model=list[Camera])
async def get_cameras() -> list[Camera]:
    """
    Return every camera with computed online status, live edge url, geo coordinates, and sensitivity preset.
    Threshold for online feed is 60 seconds (Route 4).
    """
    sb = get_supabase()
    cam_resp = sb.table("cameras").select("*").execute()

    # If Supabase has cameras, use them; if empty, fall back to pilot defaults
    rows = cam_resp.data if cam_resp.data else [{"camera_id": cid} for cid in _CAMERA_DEFAULTS]

    now = datetime.now(timezone.utc)
    threshold = now - timedelta(seconds=60)

    # Ensure CAM-AU-01 and other pilot cameras appear even if missing from DB
    seen_ids = {r["camera_id"] for r in rows}
    for cid, defs in _CAMERA_DEFAULTS.items():
        if cid not in seen_ids:
            rows.append({"camera_id": cid, **defs})

    return [_camera(row, threshold) for row in rows]


def _camera(row: dict, threshold: datetime) -> Camera:
    """One camera row with computed online flag, black_since, geo, and runtime values."""
    cam_id = row["camera_id"]
    defs = _CAMERA_DEFAULTS.get(cam_id, {})
    runtime = _CAMERA_RUNTIME.get(cam_id, {})

    last_frame_at: str | None = runtime.get("last_frame_at") or row.get("last_frame_at")
    black_since: str | None = row.get("black_since") or defs.get("black_since")

    # Determine online status
    online = False
    if cam_id == "CAM-HC-02":
        online = False
        black_since = black_since or "2026-10-07T14:30:00+08:00"
    elif last_frame_at is not None:
        try:
            last_dt = datetime.fromisoformat(last_frame_at.replace("Z", "+00:00"))
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=timezone.utc)
            online = last_dt > threshold
        except (ValueError, TypeError):
            online = False

        if not online and not black_since:
            black_since = last_frame_at

    return Camera(
        camera_id=cam_id,
        location=runtime.get("location") or row.get("location") or defs.get("location", "Camera location"),
        zone_type=runtime.get("zone_type") or row.get("zone_type") or defs.get("zone_type", "auditorium"),
        online=online,
        last_frame_at=last_frame_at,
        black_since=black_since,
        people_count=runtime.get("people_count", row.get("people_count", defs.get("people_count", 0))),
        geo=row.get("geo") or defs.get("geo"),
        source=runtime.get("source") or row.get("source") or defs.get("source", "recorded"),
        recorded_at=runtime.get("recorded_at") or row.get("recorded_at") or defs.get("recorded_at"),
        edge_url=runtime.get("edge_url") or row.get("edge_url") or defs.get("edge_url"),
        sensitivity=runtime.get("sensitivity") or row.get("sensitivity") or "strict",
    )


# ── POST /cameras/heartbeat (Route 4) ─────────────────────────────────────────

@router.post("/cameras/heartbeat", response_model=CameraHeartbeatResponse)
async def camera_heartbeat(body: CameraHeartbeat) -> CameraHeartbeatResponse:
    """
    Route 4: Edge sends heartbeat every 10 s per camera.
    Updates last_frame_at (online check threshold 60 s).
    Returns {zone_type, sensitivity} so camera setting changes take effect on the edge within 10 s.
    """
    sb = get_supabase()
    now_iso = datetime.now(timezone.utc).isoformat()
    cid = body.camera_id

    entry = _CAMERA_RUNTIME.setdefault(cid, {})
    entry["last_frame_at"] = now_iso
    if body.people_count is not None:
        entry["people_count"] = body.people_count
    if body.edge_url:
        entry["edge_url"] = body.edge_url
    if body.source:
        entry["source"] = body.source
    if body.recorded_at:
        entry["recorded_at"] = body.recorded_at

    try:
        sb.table("cameras").update({"last_frame_at": now_iso}).eq("camera_id", cid).execute()
    except Exception:
        pass

    zone_type = entry.get("zone_type")
    sensitivity = entry.get("sensitivity", "strict")
    if not zone_type:
        try:
            row = sb.table("cameras").select("zone_type").eq("camera_id", cid).limit(1).execute().data
            if row:
                zone_type = row[0]["zone_type"]
        except Exception:
            pass
    zone_type = zone_type or _CAMERA_DEFAULTS.get(cid, {}).get("zone_type", "auditorium")

    return CameraHeartbeatResponse(
        ok=True,
        camera_id=cid,
        zone_type=zone_type,
        sensitivity=sensitivity,
    )


# ── PATCH /cameras/{camera_id} (Routes 5 & 20) ────────────────────────────────

def zone_change_error(zone_type: str, site_zones: list[str]) -> str | None:
    """Why a zone change is refused, or None when it is allowed."""
    if not zone_type.strip():
        return "zone_type is empty."
    if site_zones and zone_type not in site_zones:
        return f"Unknown zone_type {zone_type!r}. This site's zones: {', '.join(sorted(site_zones))}."
    return None


@router.patch("/cameras/{camera_id}", response_model=Camera)
async def patch_camera(camera_id: str, body: CameraPatch) -> Camera:
    """
    Move a camera to another zone of the site (Route 5) and/or change
    sensitivity preset ('strict' | 'sensitive') (Route 20).
    """
    sb = get_supabase()
    found = sb.table("cameras").select("*").eq("camera_id", camera_id).limit(1).execute()
    if not found.data and camera_id not in _CAMERA_DEFAULTS:
        raise HTTPException(status_code=404, detail=f"Camera {camera_id} not found.")

    entry = _CAMERA_RUNTIME.setdefault(camera_id, {})

    if body.zone_type is not None:
        zones = sb.table("zones").select("zone_type").execute().data or []
        err = zone_change_error(body.zone_type, [z["zone_type"] for z in zones])
        if err:
            raise HTTPException(status_code=422, detail=err)
        entry["zone_type"] = body.zone_type
        try:
            sb.table("cameras").update({"zone_type": body.zone_type}).eq("camera_id", camera_id).execute()
        except Exception:
            pass

    if body.sensitivity is not None:
        if body.sensitivity not in ("strict", "sensitive"):
            raise HTTPException(status_code=422, detail="sensitivity must be 'strict' or 'sensitive'.")
        entry["sensitivity"] = body.sensitivity
        try:
            sb.table("cameras").update({"sensitivity": body.sensitivity}).eq("camera_id", camera_id).execute()
        except Exception:
            pass

    cam_row = found.data[0] if found.data else {"camera_id": camera_id}
    return _camera(cam_row, datetime.now(timezone.utc) - timedelta(seconds=60))
