"""
EarlyEye API — Pydantic models (matches the contract in §6 of earlyeye-TEAM-FINAL.md
and Kayla's TypeScript types in web/src/lib/types.ts).
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

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


class BackupRequest(BaseModel):
    """POST /events/{id}/backup. staff omitted = the next guard on duty."""
    staff: Optional[str] = None
    reason: str = "need_backup"   # "need_backup" | "no_answer"


class StaffDuty(BaseModel):
    on_duty: bool


class Outcome(str, Enum):
    """What the guard found on arrival (guard app, "What did you find?")."""
    sorted = "sorted"
    hurt = "hurt"
    backup = "backup"
    nothing = "nothing"


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


class StaffShift(BaseModel):
    """A person's usual shift. days: 0=Mon … 6=Sun. from/to are "HH:MM"; to < from means it ends after midnight."""
    model_config = {"populate_by_name": True}
    label: str                                  # "Mon–Sat 07:00–15:00"
    days: list[int]
    from_: str = Field(alias="from")
    to: str


class SiteStaff(BaseModel):
    """A person on the team. name is the call sign used everywhere else (nearest_staff, pushed_to)."""
    name: str                                   # call sign, e.g. "Guard B"
    display_name: Optional[str] = None          # "Aiman Hakimi"
    photo_url: Optional[str] = None
    role: Optional[str] = None                  # "guard" | "warden" | "supervisor"
    zone_type: Optional[str] = None             # base zone
    shift: Optional[StaffShift] = None
    on_duty: Optional[bool] = None


class Site(BaseModel):
    site_id: str
    name: str
    site_type: SiteType
    zones: list[Zone]
    staff: list[SiteStaff] = Field(default_factory=list)


class Camera(BaseModel):
    camera_id: str
    location: str
    zone_type: str
    online: bool = True
    last_frame_at: Optional[str] = None
    black_since: Optional[str] = None


class CameraPatch(BaseModel):
    """PATCH /cameras/{camera_id}. The manager changes a camera's zone on Track record
    ("Make it a sports zone"). zone_type must be one of the site's zones."""
    zone_type: str


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
    # v3 optional (contract): keypoints only, never pixels. Stored when the columns exist.
    snapshot: Optional[dict[str, Any]] = None
    peak_snapshot: Optional[dict[str, Any]] = None
    top_features: Optional[list[dict[str, Any]]] = None


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
    acked_at: Optional[str] = None
    arrived_at: Optional[str] = None
    outcome: Optional[Outcome] = None
    outcome_at: Optional[str] = None
    status: Status
    staff_note: Optional[str] = None
    snapshot: Optional[dict[str, Any]] = None
    peak_snapshot: Optional[dict[str, Any]] = None
    top_features: Optional[list[dict[str, Any]]] = None


class EventPatch(BaseModel):
    """PATCH body. The desk sends status (+ staff_note); the duty phone sends acked_at ("On my way"),
    arrived_at ("I'm here") and outcome + outcome_at ("What did you find?")."""
    status: Optional[Status] = None
    staff_note: Optional[str] = None
    pushed_to: Optional[str] = None     # desk "Push now": the guard it chose (else the API picks)
    pushed_at: Optional[str] = None
    acked_at: Optional[str] = None
    arrived_at: Optional[str] = None
    outcome: Optional[Outcome] = None
    outcome_at: Optional[str] = None


# ── Hotspot & Patrol Plan ─────────────────────────────────────────────────────

class Hotspot(BaseModel):
    location: str
    zone_type: str
    weekday: int
    hour: int
    count: int
    last_seen: str


class SlotStatus(str, Enum):
    active = "active"
    suggested = "suggested"
    ended = "ended"


class Checkin(BaseModel):
    staff: str
    at: str


class PatrolSlot(BaseModel):
    """A standing guard post. Active posts stay until the supervisor ends them; the daily
    06:00 recheck only adds suggestions (status "suggested") or sets suggestion = "end"."""
    id: Optional[str] = None
    location: str
    zone_type: Optional[str] = None
    days: str
    hours: str
    incidents_4w: int
    expected_avoided_per_week: float
    rationale: str
    status: SlotStatus = SlotStatus.active
    since: Optional[str] = None
    assigned_to: Optional[str] = None           # call sign
    seen_at: Optional[str] = None               # when the guard opened it in their app
    tip: Optional[str] = None
    suggestion: Optional[str] = None            # "add" | "end" | None
    ended_at: Optional[str] = None
    evidence: list[str] = Field(default_factory=list)
    checkins: list[Checkin] = Field(default_factory=list)


class SlotPatch(BaseModel):
    """PATCH /plan/slots/{id}. assigned_to may be sent as null ("Nobody")."""
    status: Optional[SlotStatus] = None
    assigned_to: Optional[str] = None
    seen_at: Optional[str] = None


class CheckinCreate(BaseModel):
    staff: str
    at: Optional[str] = None


class PatrolPlan(BaseModel):
    generated_at: str
    slots: list[PatrolSlot]
    last_check: Optional[str] = None            # last 06:00 recheck
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
    fa_per_camera_hour: Optional[float] = None      # null until own footage is measured
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


# ── Reports (SHOULD #8) ───────────────────────────────────────────────────────

class ReportRequest(BaseModel):
    period: str = "last_week"  # 'last_week', 'last_month', 'all_time'
    site_id: Optional[str] = None
    language: str = "bilingual"  # 'bilingual', 'en', 'bm'


class ReportResponse(BaseModel):
    generated_at: str
    period: str
    total_incidents: int
    severity_breakdown: dict[str, int]
    type_breakdown: dict[str, int]
    hotspot_summary: list[dict]
    cited_incident_ids: list[str]
    report_markdown: str


# ── Knowledge Bank (CUT #1: pgvector & RAG) ───────────────────────────────────

class KnowledgeCategory(str, Enum):
    sop = "sop"
    legal = "legal"
    de_escalation = "de_escalation"
    site_policy = "site_policy"


class KnowledgeCreate(BaseModel):
    title: str
    category: KnowledgeCategory
    content: str
    metadata: dict = Field(default_factory=dict)


class KnowledgeDoc(BaseModel):
    id: int
    title: str
    category: str
    content: str
    metadata: dict = Field(default_factory=dict)
    similarity: Optional[float] = None


class KnowledgeSearchQuery(BaseModel):
    query: str
    category: Optional[KnowledgeCategory] = None
    limit: int = 4
    match_threshold: float = 0.3


# ── AI Agent Tool Loop & Staff Chat (CUT #2) ──────────────────────────────────

class ChatMessage(BaseModel):
    role: str  # 'user', 'assistant', 'system'
    content: str


class AgentChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)
    site_id: Optional[str] = "TAYLORS-LK"


class AgentToolCall(BaseModel):
    tool: str
    input: dict
    output: dict


class AgentChatResponse(BaseModel):
    response: str
    tool_calls: list[AgentToolCall] = Field(default_factory=list)
    cited_knowledge: list[str] = Field(default_factory=list)
    cited_incidents: list[str] = Field(default_factory=list)


# ── Notifications (CUT #4) ────────────────────────────────────────────────────

class NotificationRequest(BaseModel):
    incident_id: str
    recipient_name: str
    recipient_contact: str  # e.g. "60123456789"
    channel: str = "whatsapp"  # 'whatsapp', 'sms', 'webhook'
    custom_message: Optional[str] = None


class NotificationResponse(BaseModel):
    id: Optional[int] = None
    incident_id: str
    recipient_name: str
    recipient_contact: str
    channel: str
    message: str
    whatsapp_url: Optional[str] = None
    status: str
    sent_at: str


# ── Incident Clip Storage (CUT #5) ───────────────────────────────────────────

class ClipMetadata(BaseModel):
    clip_id: Optional[int] = None
    incident_id: str
    clip_url: str
    thumbnail_url: Optional[str] = None
    duration_seconds: float = 10.0
    fps: int = 25
    camera_id: Optional[str] = None
    created_at: Optional[str] = None


# ── Auth & Role Management (CUT #7) ───────────────────────────────────────────

class UserRole(str, Enum):
    operator = "operator"
    warden = "warden"
    security_manager = "security_manager"
    admin = "admin"


class LoginRequest(BaseModel):
    username: str
    password: str


class UserProfile(BaseModel):
    username: str
    full_name: str
    role: UserRole
    site_id: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserProfile


# ── Shift handover (POST /handover) ───────────────────────────────────────────

class OpenIncident(BaseModel):
    incident_id: str
    location: str
    level: str
    priority: float = 0
    status: str = ""


class BlackCamera(BaseModel):
    camera_id: str
    location: str
    black_since: str


class HandoverFacts(BaseModel):
    """What the end-of-shift drawer counted. Posted as-is; nothing is recomputed."""

    shift_start: str
    now: str
    pushes: int
    budget: int
    open: list[OpenIncident] = Field(default_factory=list)
    confirmed: int = 0
    dismissed: int = 0
    black_cameras: list[BlackCamera] = Field(default_factory=list)
    patrol_today: Optional[str] = None


class HandoverBrief(BaseModel):
    text: str
    model: str  # ANTHROPIC_MODEL, or "offline-template"
    generated_at: str
