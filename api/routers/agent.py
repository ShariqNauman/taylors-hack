"""
EarlyEye API — AI Security Copilot Router (CUT List #2)

Provides an agentic chat endpoint for control-room operators and site wardens.
Runs an automated multi-step tool loop over knowledge, cameras, incidents, and dispatches.
"""

from __future__ import annotations

from fastapi import APIRouter

from api.models import AgentChatRequest, AgentChatResponse
from api.services.agent_service import agent_service

router = APIRouter(prefix="", tags=["agent"])


@router.post("/agent/chat", response_model=AgentChatResponse)
def agent_chat(req: AgentChatRequest):
    """
    Control-room AI Copilot tool loop.
    Understands questions about active incidents, dead cameras, de-escalation protocols,
    and patrol recommendations, executing underlying database and RAG tools automatically.
    """
    return agent_service.process_chat(
        message=req.message,
        history=req.history,
        site_id=req.site_id or "TAYLORS-LK",
    )


@router.get("/agent/tools")
def list_agent_tools():
    """List available capabilities in the AI agent's toolbelt."""
    return {
        "tools": [
            {
                "name": "search_knowledge_bank",
                "description": "RAG search across Malaysian Penal Code s.507, KPM guidelines, and de-escalation SOPs",
            },
            {
                "name": "query_incidents",
                "description": "Query live and historical incidents filtered by level, location, and priority",
            },
            {
                "name": "get_camera_health",
                "description": "Inspect camera feed uptime and detect offline sensors ('black for 3 days')",
            },
            {
                "name": "get_patrol_plan",
                "description": "Retrieve current optimal patrol plan and expected incidents avoided",
            },
            {
                "name": "dispatch_staff",
                "description": "Send urgent physical dispatch notification to assigned warden or guard",
            },
        ]
    }
