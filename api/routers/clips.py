"""
EarlyEye API — Incident Video Clip & Keyframe Storage Router (CUT List #5)

Stores and serves 10-second escalation video buffers and thumbnail keyframes.
Supports Supabase Storage bucket URLs or local streaming endpoints.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException

from api.db import get_supabase
from api.models import ClipMetadata

router = APIRouter(prefix="", tags=["clips"])

_CLIPS_REGISTRY: dict[str, ClipMetadata] = {}


@router.post("/events/{incident_id}/clip", response_model=ClipMetadata)
def register_incident_clip(
    incident_id: str,
    clip_url: str = None,
    thumbnail_url: str = None,
    duration_seconds: float = 10.0,
    camera_id: str = None,
):
    """
    Register a 10-second incident video clip for an escalation event.
    Video clips are captured locally at the edge and uploaded upon elevated aggression.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    final_clip_url = clip_url or f"/static/clips/{incident_id}.mp4"
    final_thumb_url = thumbnail_url or f"/static/thumbs/{incident_id}.jpg"

    meta = ClipMetadata(
        clip_id=len(_CLIPS_REGISTRY) + 1,
        incident_id=incident_id,
        clip_url=final_clip_url,
        thumbnail_url=final_thumb_url,
        duration_seconds=duration_seconds,
        fps=25,
        camera_id=camera_id,
        created_at=now_iso,
    )
    _CLIPS_REGISTRY[incident_id] = meta

    # Try storing to Supabase incident_clips table if available
    try:
        sb = get_supabase()
        sb.table("incident_clips").insert(
            {
                "incident_id": incident_id,
                "clip_url": final_clip_url,
                "thumbnail_url": final_thumb_url,
                "duration_seconds": duration_seconds,
                "camera_id": camera_id,
            }
        ).execute()
    except Exception:
        pass

    return meta


@router.get("/events/{incident_id}/clip", response_model=ClipMetadata)
def get_incident_clip(incident_id: str):
    """Retrieve video playback and thumbnail information for an incident."""
    # Check Supabase first
    try:
        sb = get_supabase()
        res = sb.table("incident_clips").select("*").eq("incident_id", incident_id).limit(1).execute()
        if res.data:
            return ClipMetadata(**res.data[0])
    except Exception:
        pass

    # Check local registry
    if incident_id in _CLIPS_REGISTRY:
        return _CLIPS_REGISTRY[incident_id]

    # Return default synthetic clip placeholder
    return ClipMetadata(
        clip_id=0,
        incident_id=incident_id,
        clip_url=f"/static/clips/demo_escalation.mp4",
        thumbnail_url="/ir-frame.jpg",
        duration_seconds=10.0,
        fps=25,
        camera_id="CAM-BLK-C1",
        created_at=datetime.now(timezone.utc).isoformat(),
    )
