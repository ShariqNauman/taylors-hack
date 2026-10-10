"""
EarlyEye API — FastAPI Application Entry Point

Start locally:
    uvicorn api.main:app --reload --port 8000

Deployed on Render as a web service.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.config import APP_DESCRIPTION, APP_TITLE, APP_VERSION, CORS_ORIGINS
from api.routers import (
    agent,
    auth,
    clips,
    events,
    hotspots,
    knowledge,
    notifications,
    plan,
    proof,
    push,
    reports,
    site,
    sites,
)


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title=APP_TITLE,
    version=APP_VERSION,
    description=APP_DESCRIPTION,
)

# ── CORS (wide open for hackathon — frontend on Vercel, edge on any IP) ──────

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Core Routers (MUST Items) ─────────────────────────────────────────────────

app.include_router(site.router)
app.include_router(events.router)
app.include_router(hotspots.router)
app.include_router(plan.router)
app.include_router(push.router)
app.include_router(proof.router)

# ── Advanced Routers (SHOULD & CUT Items) ─────────────────────────────────────

app.include_router(reports.router)
app.include_router(knowledge.router)
app.include_router(agent.router)
app.include_router(notifications.router)
app.include_router(clips.router)
app.include_router(sites.router)
app.include_router(auth.router)


# ── Health check (Render uses this to know the service is up) ─────────────────

@app.get("/health", tags=["health"])
def health():
    """Health check endpoint for Render and uptime monitoring."""
    return {"status": "ok", "service": "earlyeye-api"}


@app.get("/", tags=["health"])
def root():
    """Root endpoint — confirms the API is running."""
    return {
        "service": "EarlyEye API",
        "version": APP_VERSION,
        "docs": "/docs",
        "health": "/health",
    }
