"""
EarlyEye API — Pydantic models (matches the contract in §6 of earlyeye-TEAM-FINAL.md
and Kayla's TypeScript types in web/src/lib/types.ts).
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ── Enums ─────────────────────────────────────────────────────────────────────

class SiteType(str, Enum):
    campus = "campus"
    school = "school"
    mall = "mall"
    factory = "factory"
    transit = "transit"


class IncidentType(str, Enum):
    fight = "fight"
    cornering = "cornering"
    crowd = "crowd"
    play = "play"


class Level(str, Enum):
    calm = "calm"
    tense = "tense"
    fight_likely = "fight_likely"
    fight = "fight"


class Status(str, Enum):
    new = "new"
    pushed = "pushed"
    confirmed = "confirmed"
    dismissed = "dismissed"
    resolved = "resolved"
    false_alarm = "false_alarm"


# ── Site & Camera ─────────────────────────────────────────────────────────────

class Zone(BaseModel):
    zone_type: str
    label: str
    risk: float = Field(ge=0, le=1)


class Site(BaseModel):
    site_id: str
    name: str
    site_type: SiteType
    zones: list[Zone]


class Camera(BaseModel):
    camera_id: str
    location: str
    zone_type: str
    online: bool = True
    last_frame_at: Optional[str] = None
    black_since: Optional[str] = None


# ── Event (the core incident record) ─────────────────────────────────────────

class EventCreate(BaseModel):
    """What the edge app POSTs. incident_id is optional (server generates)."""
    incident_id: Optional[str] = None
    camera_id: str
    location: str
    zone_type: str
    start_time: str
    end_time: Optional[str] = None
    type: IncidentType
    level: Level
    peak_score: float = Field(ge=0, le=1)
    eta_seconds: Optional[float] = None
    priority: Optional[float] = None          # server computes if missing
    reason: str
    people_count: int = Field(ge=1)
    action: str
    nearest_staff: Optional[str] = None
    status: Status = Status.new
    staff_note: Optional[str] = None


class Event(BaseModel):
    """Full event record as stored and returned by the API."""
    incident_id: str
    camera_id: str
    location: str
    zone_type: str
    start_time: str
    end_time: Optional[str] = None
    type: IncidentType
    level: Level
    peak_score: float
    eta_seconds: Optional[float] = None
    priority: float
    reason: str
    people_count: int
    action: str
    nearest_staff: Optional[str] = None
    pushed_to: Optional[str] = None
    pushed_at: Optional[str] = None
    status: Status
    staff_note: Optional[str] = None


class EventPatch(BaseModel):
    """PATCH body for confirming / dismissing / resolving an event."""
    status: Status
    staff_note: Optional[str] = None


# ── Hotspot & Patrol Plan ─────────────────────────────────────────────────────

class Hotspot(BaseModel):
    location: str
    zone_type: str
    weekday: int
    hour: int
    count: int
    last_seen: str


class PatrolSlot(BaseModel):
    location: str
    days: str
    hours: str
    incidents_4w: int
    expected_avoided_per_week: float
    rationale: str


class PatrolPlan(BaseModel):
    generated_at: str
    slots: list[PatrolSlot]
    assumption: str = (
        "60% of hotspot incidents avoided when a person is present "
        "(stated, not measured)"
    )


# ── Proof ─────────────────────────────────────────────────────────────────────

class IRCheck(BaseModel):
    frames: int
    skeletons_detected: int
    note: str
    image: str


class ModelCard(BaseModel):
    inputs: str
    windows: str
    classifier: str
    split: str
    threshold: str
    failure_modes: list[str]


class CCTVDomain(BaseModel):
    datasets: list[str]
    auc: float
    precision: float
    recall: float


class Proof(BaseModel):
    datasets: list[str]
    n_clips: int
    clip_auc: float
    clip_precision: float
    clip_recall: float
    cctv_domain: Optional[CCTVDomain] = None
    live_precision: Optional[float] = None
    live_recall: Optional[float] = None
    fa_per_camera_hour: float
    own_footage_minutes: float
    airtlab_fp_rate: float
    lead_time_s: list[float]
    pushes_per_shift_target: int = 3
    latency_ms: float
    ir_check: IRCheck
    model_card: ModelCard
    disclosure: str
    note: Optional[str] = None


# ── Staff ─────────────────────────────────────────────────────────────────────

class Staff(BaseModel):
    staff_id: str
    name: str
    role: str
    zone: Optional[str] = None
