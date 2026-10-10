"""
EarlyEye API — Notification Dispatch Router (CUT List #4)

Handles two-tier alert dispatching to wardens and guards:
- Formats instant one-click WhatsApp action links (`https://wa.me/{phone}?text=...`)
- Emits webhooks to external security notification channels
- Maintains an immutable audit trail of sent notifications
"""

from __future__ import annotations

import urllib.parse
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
import httpx

from api.config import DEFAULT_ALERT_WEBHOOK_URL
from api.db import get_supabase
from api.models import NotificationRequest, NotificationResponse

router = APIRouter(prefix="", tags=["notifications"])

# In-memory backup audit log
_NOTIFICATIONS_LOG: list[dict] = []


@router.post("/notifications/dispatch", response_model=NotificationResponse)
def dispatch_notification(req: NotificationRequest):
    """
    Dispatch an urgent alert for an incident to a designated warden or security guard.
    Generates a pre-formatted WhatsApp dispatch link and fires external webhooks.
    """
    sb = get_supabase()
    now_iso = datetime.now(timezone.utc).isoformat()

    # Look up incident info
    incident_info = {"location": "Site Area", "level": "fight_likely", "reason": "Aggression spike detected"}
    try:
        res = sb.table("events").select("*").eq("incident_id", req.incident_id).limit(1).execute()
        if res.data:
            incident_info = res.data[0]
    except Exception:
        pass

    # Build clear message body
    default_msg = (
        f"[ALERT] [EARLYEYE ALERT] {incident_info.get('level', 'ALERT').upper()} at {incident_info.get('location')}!\n"
        f"Incident: {req.incident_id}\n"
        f"Reason: {incident_info.get('reason')}\n"
        f"Action: Immediate de-escalation presence requested for {req.recipient_name}."
    )
    msg = req.custom_message or default_msg

    # Generate WhatsApp URL
    clean_phone = "".join(c for c in req.recipient_contact if c.isdigit())
    if clean_phone.startswith("0"):
        clean_phone = "6" + clean_phone  # Format Malaysian numbers
    whatsapp_url = f"https://wa.me/{clean_phone}?text={urllib.parse.quote(msg)}"

    # If external webhook configured, dispatch async ping
    if DEFAULT_ALERT_WEBHOOK_URL:
        try:
            with httpx.Client(timeout=3.0) as client:
                client.post(DEFAULT_ALERT_WEBHOOK_URL, json={"incident_id": req.incident_id, "message": msg})
        except Exception:
            pass

    # Persist notification log
    notif_id = len(_NOTIFICATIONS_LOG) + 1
    log_entry = {
        "id": notif_id,
        "incident_id": req.incident_id,
        "recipient_name": req.recipient_name,
        "recipient_contact": req.recipient_contact,
        "channel": req.channel,
        "message": msg,
        "whatsapp_url": whatsapp_url,
        "status": "sent",
        "sent_at": now_iso,
    }
    _NOTIFICATIONS_LOG.append(log_entry)

    try:
        sb.table("notifications").insert(
            {
                "incident_id": req.incident_id,
                "recipient_name": req.recipient_name,
                "recipient_contact": req.recipient_contact,
                "channel": req.channel,
                "message": msg,
                "status": "sent",
            }
        ).execute()
    except Exception:
        pass

    return NotificationResponse(**log_entry)


@router.get("/notifications", response_model=list[NotificationResponse])
def list_notifications(incident_id: Optional[str] = None):
    """Retrieve audit log of dispatched notifications."""
    try:
        sb = get_supabase()
        q = sb.table("notifications").select("*").order("sent_at", desc=True).limit(50)
        if incident_id:
            q = q.eq("incident_id", incident_id)
        res = q.execute()
        if res.data:
            return [NotificationResponse(**row) for row in res.data]
    except Exception:
        pass

    # Fallback to local memory log
    if incident_id:
        return [NotificationResponse(**n) for n in _NOTIFICATIONS_LOG if n["incident_id"] == incident_id]
    return [NotificationResponse(**n) for n in reversed(_NOTIFICATIONS_LOG[-50:])]
