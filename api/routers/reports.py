"""
EarlyEye API — Weekly Report Router (SHOULD Item #8 / Route 17)

Generates an executive incident & security audit report over SQL data
in English and Bahasa Malaysia, citing real incident IDs and hotspot data.
Uses Claude (claude-sonnet-5-5) when ANTHROPIC_API_KEY is available.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
import httpx

from api.config import ANTHROPIC_API_KEY, ANTHROPIC_MODEL
from api.db import get_supabase
from api.models import ReportRequest, ReportResponse
from api.routers.hotspots import get_hotspots, get_plan

router = APIRouter(prefix="", tags=["reports"])


@router.post("/report", response_model=ReportResponse)
def generate_report(req: ReportRequest):
    """
    Generate an executive weekly or monthly security report based on database records.
    Filters by requested period ('last_week', 'last_month', 'all_time').
    Cites verified incident IDs, hotspot clusters, and real data without invented numbers.
    """
    sb = get_supabase()
    now = datetime.now(timezone.utc)

    # Filter events based on requested period
    query = sb.table("events").select("incident_id, location, zone_type, level, type, start_time, status")
    if req.period == "last_week":
        cutoff = (now - timedelta(days=7)).isoformat()
        query = query.gte("start_time", cutoff)
    elif req.period == "last_month":
        cutoff = (now - timedelta(days=30)).isoformat()
        query = query.gte("start_time", cutoff)

    try:
        events_resp = query.order("start_time", desc=True).limit(500).execute()
        events = events_resp.data or []
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Database query failed: {exc}")

    total_incidents = len(events)
    severity_counts = dict(Counter(e["level"] for e in events))
    type_counts = dict(Counter(e["type"] for e in events))
    hotspots = get_hotspots()
    plan = get_plan()

    cited_ids = [e["incident_id"] for e in events[:6]]
    top_hotspot_locs = [h.location for h in hotspots[:2]]

    now_str = now.strftime("%d %B %Y, %H:%M UTC")

    # Dynamic Claude synthesis
    claude_summary = None
    if ANTHROPIC_API_KEY:
        try:
            prompt = (
                f"You are the Lead Security Analyst for EarlyEye at Taylor's Lakeside Campus. "
                f"Write a 3-paragraph executive security report for the period '{req.period}' based strictly on this verified data:\n"
                f"- Total incidents: {total_incidents}\n"
                f"- Severity breakdown: {severity_counts}\n"
                f"- Incident types: {type_counts}\n"
                f"- Top hotspot locations: {top_hotspot_locs}\n"
                f"- Cited Incident IDs: {cited_ids}\n"
                f"Do not invent statistics or numbers not in this prompt. "
                f"Write in formal English with a short Bahasa Malaysia summary paragraph at the end."
            )
            with httpx.Client(timeout=15.0) as client:
                res = client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": ANTHROPIC_API_KEY,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": ANTHROPIC_MODEL,
                        "max_tokens": 800,
                        "messages": [{"role": "user", "content": prompt}],
                    },
                )
                if res.status_code == 200:
                    claude_summary = res.json()["content"][0]["text"]
        except Exception:
            pass

    if not claude_summary:
        # Factual fallback based strictly on real queried numbers
        fights = severity_counts.get("fight", 0)
        fight_likely = severity_counts.get("fight_likely", 0)
        hotspot_bullets = "\n".join(
            f"- **{h.location}:** {h.count} incidents concentrated around {h.hour:02d}:00."
            for h in hotspots[:3]
        ) or "- No recurring hotspots in this period."

        claude_summary = (
            f"### Executive Security Overview — Taylor's Lakeside Campus\n\n"
            f"Over the reporting period ({req.period}), the EarlyEye early-warning system recorded "
            f"**{total_incidents} physical-interaction detections**. "
            f"Severity breakdown: **{fight_likely}** flagged as `fight_likely`, and **{fights}** escalated to `fight`.\n\n"
            f"#### Verified Hotspot Locations\n"
            f"{hotspot_bullets}\n\n"
            f"Sample verified incident records: {', '.join(f'`{cid}`' for cid in cited_ids) if cited_ids else 'None'}.\n\n"
            f"#### Ringkasan Eksekutif (Bahasa Malaysia)\n"
            f"Sepanjang tempoh laporan ({req.period}), sistem EarlyEye merekodkan sebanyak {total_incidents} insiden fizikal. "
            f"Pasukan keselamatan disyorkan meronda lokasi tumpuan mengikut jadual rondaan standing posts bagi mencegah ketegangan."
        )

    hotspot_summary_list = [
        {"location": h.location, "weekday": h.weekday, "hour": h.hour, "count": h.count}
        for h in hotspots[:5]
    ]

    return ReportResponse(
        generated_at=now_str,
        period=req.period,
        total_incidents=total_incidents,
        severity_breakdown=severity_counts,
        type_breakdown=type_counts,
        hotspot_summary=hotspot_summary_list,
        cited_incident_ids=cited_ids,
        report_markdown=claude_summary,
    )
