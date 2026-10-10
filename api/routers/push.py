"""
EarlyEye API — Web Push for the guard app.

GET  /push/key           → {public_key}: the VAPID key the phone subscribes with (404 when push is off).
POST /push/subscribe     → {staff, subscription: {endpoint, keys}}: Start my shift on this phone.
POST /push/unsubscribe   → {endpoint}: End my shift / switch person.

notify(staff) wakes every phone subscribed for that call sign; called whenever the API pushes an
alert to someone (POST /events, Push now, backup, the 20-s escalation).
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.db import get_supabase
from api.services import webpush

router = APIRouter(prefix="", tags=["push"])


class Subscribe(BaseModel):
    staff: str
    subscription: dict[str, Any]


class Unsubscribe(BaseModel):
    endpoint: str
    staff: Optional[str] = None


@router.get("/push/key")
async def push_key() -> dict:
    if not webpush.enabled():
        raise HTTPException(status_code=404, detail="Web Push is off: set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.")
    return {"public_key": webpush.VAPID_PUBLIC_KEY}


@router.post("/push/subscribe", status_code=201)
async def subscribe(body: Subscribe) -> dict:
    endpoint = body.subscription.get("endpoint")
    if not endpoint or not str(endpoint).startswith("https://"):
        raise HTTPException(status_code=422, detail="subscription.endpoint must be an https URL")
    sb = get_supabase()
    try:
        sb.table("push_subscriptions").upsert(
            {"endpoint": endpoint, "staff": body.staff, "subscription": body.subscription},
            on_conflict="endpoint",
        ).execute()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Run api/sql/migration_push.sql first ({exc})")
    return {"staff": body.staff, "endpoint": endpoint}


@router.post("/push/unsubscribe")
async def unsubscribe(body: Unsubscribe) -> dict:
    sb = get_supabase()
    try:
        sb.table("push_subscriptions").delete().eq("endpoint", body.endpoint).execute()
    except Exception:
        pass
    return {"endpoint": body.endpoint, "removed": True}


async def notify(staff: Optional[str]) -> int:
    """Wake every phone of this guard. Returns how many push services accepted. Never raises."""
    if not staff or not webpush.enabled():
        return 0
    sb = get_supabase()
    try:
        rows = sb.table("push_subscriptions").select("endpoint").eq("staff", staff).execute().data or []
    except Exception:
        return 0
    sent = 0
    for r in rows:
        try:
            status = await webpush.send(r["endpoint"])
        except Exception:
            continue
        if status in (404, 410):   # the phone unsubscribed or the browser dropped it
            try:
                sb.table("push_subscriptions").delete().eq("endpoint", r["endpoint"]).execute()
            except Exception:
                pass
        elif 200 <= status < 300:
            sent += 1
    return sent
