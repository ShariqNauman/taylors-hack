"""
EarlyEye API — Site & Camera router.

GET /site    → returns the demo site with its zones and team (staff) embedded.
GET /cameras → returns all cameras with computed online / black_since status.
PATCH /cameras/{camera_id} {zone_type} → the manager moves a camera to another zone of the site.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from api.db import get_supabase
from api.models import Camera, CameraPatch, Site, SiteStaff, StaffShift, Zone

router = APIRouter(prefix="", tags=["site"])


# ── GET /site ─────────────────────────────────────────────────────────────────

@router.get("/site", response_model=Site)
async def get_site() -> Site:
    """
    Return the single demo site with its zones.

    Queries the 'sites' table (limit 1) and the 'zones' table filtered by
    that site's ID, then returns a combined Site object.
    """
    sb = get_supabase()

    # Fetch the first (demo) site
    site_resp = sb.table("sites").select("*").limit(1).execute()

    if not site_resp.data:
        raise HTTPException(status_code=404, detail="No site found.")

    site_row = site_resp.data[0]

    # Fetch zones belonging to this site
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

    return Site(
        site_id=site_row["site_id"],
        name=site_row["name"],
        site_type=site_row["site_type"],
        zones=zones,
        staff=_staff(sb, site_row["site_id"]),
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
        shift = r.get("shift")
        try:
            shift = StaffShift(**shift) if isinstance(shift, dict) else None
        except Exception:
            shift = None
        out.append(SiteStaff(
            name=r["name"],
            display_name=r.get("display_name"),
            photo_url=r.get("photo_url"),
            role=r.get("role"),
            zone_type=r.get("zone"),
            shift=shift,
            on_duty=r.get("on_duty"),
        ))
    return out


# ── GET /cameras ──────────────────────────────────────────────────────────────

@router.get("/cameras", response_model=list[Camera])
async def get_cameras() -> list[Camera]:
    """
    Return every camera with a computed *online* flag.

    A camera is considered **online** when its `last_frame_at` timestamp is
    within the last 5 minutes.  If the camera is offline and `last_frame_at`
    exists, `black_since` is set to that timestamp.
    """
    sb = get_supabase()

    cam_resp = sb.table("cameras").select("*").execute()

    if not cam_resp.data:
        return []

    now = datetime.now(timezone.utc)
    threshold = now - timedelta(minutes=5)

    return [_camera(row, threshold) for row in cam_resp.data]


def _camera(row: dict, threshold: datetime) -> Camera:
    """One camera row with its computed online flag and black_since."""
    last_frame_at: str | None = row.get("last_frame_at")

    # Determine online status
    online = False
    black_since: str | None = None

    if last_frame_at is not None:
        # Parse the ISO-8601 timestamp from Supabase
        try:
            last_dt = datetime.fromisoformat(last_frame_at)
            # Ensure timezone-aware comparison
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=timezone.utc)
            online = last_dt > threshold
        except (ValueError, TypeError):
            online = False

        # If offline, record when the feed went black
        if not online:
            black_since = last_frame_at

    return Camera(
        camera_id=row["camera_id"],
        location=row["location"],
        zone_type=row["zone_type"],
        online=online,
        last_frame_at=last_frame_at,
        black_since=black_since,
    )


# ── PATCH /cameras/{camera_id} ────────────────────────────────────────────────

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
    Move a camera to another zone of the site, e.g. the sports zone after the desk keeps
    dismissing rough play there. Only zone_type changes; the heartbeat owns the rest.
    The zone's risk (from the site's zone table) then sets that camera's priority.
    """
    sb = get_supabase()
    found = sb.table("cameras").select("*").eq("camera_id", camera_id).limit(1).execute()
    if not found.data:
        raise HTTPException(status_code=404, detail=f"Camera {camera_id} not found.")

    zones = sb.table("zones").select("zone_type").execute().data or []
    err = zone_change_error(body.zone_type, [z["zone_type"] for z in zones])
    if err:
        raise HTTPException(status_code=422, detail=err)

    updated = (
        sb.table("cameras")
        .update({"zone_type": body.zone_type})
        .eq("camera_id", camera_id)
        .execute()
    )
    row = (updated.data or [{**found.data[0], "zone_type": body.zone_type}])[0]
    return _camera(row, datetime.now(timezone.utc) - timedelta(minutes=5))
