"""
EarlyEye API — Proof router.

Serves the /proof endpoint so the dashboard can display the live
"proof-of-work" metrics (AUC, precision, latency, etc.) and the ML
team can update them via PUT.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from api.db import get_supabase
from api.models import IRCheck, ModelCard, Proof

router = APIRouter(prefix="", tags=["proof"])

# ── Hardcoded placeholder returned when no DB row exists yet ─────────────────

_PLACEHOLDER = Proof(
    datasets=["RLVS", "AIRTLab"],
    n_clips=0,
    clip_auc=0.0,
    clip_precision=0.0,
    clip_recall=0.0,
    fa_per_camera_hour=0.0,
    own_footage_minutes=0.0,
    airtlab_fp_rate=0.0,
    lead_time_s=[],
    pushes_per_shift_target=3,
    latency_ms=0.0,
    ir_check=IRCheck(
        frames=0,
        skeletons_detected=0,
        note="pending",
        image="/ir-frame.jpg",
    ),
    model_card=ModelCard(
        inputs="YOLO26n-pose keypoints",
        windows="1s stride 0.5s",
        classifier="pending",
        split="GroupKFold by video",
        threshold="pending",
        failure_modes=["domain shift from phone-video to CCTV angle"],
    ),
    disclosure="Placeholder — real numbers will be inserted by the ML team.",
    note="placeholder",
)


# ── GET /proof ────────────────────────────────────────────────────────────────

@router.get("/proof", response_model=Proof)
async def get_proof():
    """Return the current proof-of-work metrics.

    Fetches the first row from the `proof` table and returns its `data`
    JSONB column.  If no row exists yet, a hardcoded placeholder is
    returned so the frontend always has something to render.
    """
    sb = get_supabase()
    result = sb.table("proof").select("data").limit(1).execute()

    if result.data:
        # The `data` column is JSONB and already contains the full Proof shape
        return result.data[0]["data"]

    # No row in the table yet — return safe defaults
    return _PLACEHOLDER


# ── PUT /proof ────────────────────────────────────────────────────────────────

@router.put("/proof", response_model=Proof)
async def upsert_proof(body: Proof):
    """Create or update the proof-of-work metrics.

    The ML team calls this endpoint to push new numbers into the DB.
    We always upsert on `id = 1` so there is at most one proof row.
    """
    sb = get_supabase()
    row = {"id": 1, "data": body.model_dump(mode="json")}

    result = (
        sb.table("proof")
        .upsert(row, on_conflict="id")
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=500, detail="Proof upsert failed")

    return result.data[0]["data"]
