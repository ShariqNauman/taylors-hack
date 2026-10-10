"""
EarlyEye API — Shift handover router.

POST /handover turns the facts the dashboard already worked out at the end of a
shift into a few sentences the next operator reads in five seconds.

The split is the whole point. Every number, name, time and location in the text
comes from the posted facts; the model is asked to word them, never to work
anything out. It gets no tools and no database, a draft is written for it first,
and the reply is thrown away if a figure appears in it that is not in the facts.
When the key is missing, Anthropic is slow, or the guard trips, the same facts
go out through the template and the response says `offline-template`, which the
drawer prints under the brief so the operator always knows who wrote the words.

Contract: api/models.py, matching web/src/lib/types.ts, and the
template below mirrors web/src/app/api/mock/handover/route.ts sentence for
sentence so the two paths cannot drift.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter

from api.config import ANTHROPIC_API_KEY, ANTHROPIC_MODEL
from api.models import HandoverBrief, HandoverFacts

router = APIRouter(prefix="", tags=["handover"])

MYT = ZoneInfo("Asia/Kuala_Lumpur")

# The dashboard aborts at 6 s (HANDOVER_TIMEOUT_MS). Stay well inside it: a late
# brief is worse than a templated one, because the drawer would show neither.
CLAUDE_TIMEOUT_S = 4.5
CLAUDE_MAX_TOKENS = 300

LEVEL_WORDS = {
    "calm": "calm",
    "tense": "tense",
    "fight_likely": "fight likely",
    "fight": "a fight",
}


# ── Helpers ──────────────────────────────────────────────────────────────────

def _parse(iso: str) -> datetime | None:
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _hhmm(iso: str) -> str:
    dt = _parse(iso)
    return dt.astimezone(MYT).strftime("%H:%M") if dt else iso


def _days_since(iso: str, now_iso: str) -> int:
    a, b = _parse(iso), _parse(now_iso)
    if not a or not b:
        return 1
    return max(1, int((b - a).total_seconds() // 86_400))


def _plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


# ── The draft ────────────────────────────────────────────────────────────────

def _template(f: HandoverFacts) -> str:
    """Four sentences, same rules as the dashboard's offline route."""
    s1 = (
        f"Shift from {_hhmm(f.shift_start)} to {_hhmm(f.now)}: "
        f"{_plural(f.pushes, 'push', 'pushes')} used out of {f.budget}, "
        f"{_plural(f.confirmed, 'alert')} confirmed as real and "
        f"{_plural(f.dismissed, 'false alarm')} dismissed."
    )

    if not f.open:
        s2 = "No incident is open, so the next shift starts clean."
    else:
        top = f.open[0]
        level = LEVEL_WORDS.get(top.level, top.level)
        labelled = "confirmed" if top.status == "confirmed" else "not yet labelled"
        if len(f.open) == 1:
            waiting = (
                "confirmed and waiting for follow-up"
                if top.status == "confirmed"
                else "not yet labelled"
            )
            s2 = f"One incident is still open: {top.location}, {level}, {waiting}."
        else:
            s2 = (
                f"{len(f.open)} incidents are still open; start with {top.location} "
                f"({level}, {labelled}), the highest priority."
            )

    if not f.black_cameras:
        s3 = "Every camera is sending a picture."
    elif len(f.black_cameras) == 1:
        c = f.black_cameras[0]
        s3 = (
            f"{c.location} ({c.camera_id}) has been black for "
            f"{_plural(_days_since(c.black_since, f.now), 'day')}; "
            "the repair is still to be reported."
        )
    else:
        s3 = (
            f"{len(f.black_cameras)} cameras are black, including "
            f"{f.black_cameras[0].location}; report the repairs."
        )

    s4 = (
        f"{f.patrol_today.rstrip('.')}, so put one person there on time."
        if f.patrol_today
        else "There is no patrol slot in the plan for today."
    )

    return " ".join([s1, s2, s3, s4])


# ── The guard ────────────────────────────────────────────────────────────────

_DIGITS = re.compile(r"\d+")


def _invents_a_number(text: str, facts: HandoverFacts, draft: str) -> bool:
    """
    True if the wording contains a run of digits that is in neither the facts nor
    the draft. Times, counts and camera IDs are all already in one or the other,
    so anything else is the model doing arithmetic we did not ask for — and a
    handover with an invented figure in it is worse than no handover.
    """
    allowed = set(_DIGITS.findall(facts.model_dump_json())) | set(_DIGITS.findall(draft))
    return any(n not in allowed for n in _DIGITS.findall(text))


# ── The wording ──────────────────────────────────────────────────────────────

SYSTEM_PROMPT = (
    "You word the end-of-shift handover that one security operator leaves for the "
    "next one. You are given the shift's facts as JSON and a plain draft of them.\n\n"
    "Rewrite the draft as three to five short sentences someone tired reads in five "
    "seconds. Lead with whatever they must act on first — an open confirmed incident "
    "outranks the statistics.\n\n"
    "Rules:\n"
    "- Use only what is in the facts. Every number, time, name and location in your "
    "reply must already appear there.\n"
    "- Never guess what an incident was, who was in it, or why it happened.\n"
    "- Never add advice the facts do not support, and never invent a next step.\n"
    "- Plain English. No jargon, no markdown, no bullet points, no heading, no "
    "sign-off.\n\n"
    "Reply with the sentences and nothing else."
)


def _word_it(facts: HandoverFacts, draft: str) -> str | None:
    """The brief in Claude's words, or None if we should use the draft instead."""
    if not ANTHROPIC_API_KEY:
        return None
    try:
        with httpx.Client(timeout=CLAUDE_TIMEOUT_S) as client:
            res = client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": ANTHROPIC_MODEL,
                    "max_tokens": CLAUDE_MAX_TOKENS,
                    "system": SYSTEM_PROMPT,
                    "messages": [
                        {
                            "role": "user",
                            "content": (
                                "Facts:\n"
                                + json.dumps(facts.model_dump(), indent=2)
                                + "\n\nDraft:\n"
                                + draft
                            ),
                        }
                    ],
                },
            )
        if res.status_code != 200:
            return None
        text = " ".join(res.json()["content"][0]["text"].split()).strip()
    except Exception:
        return None  # slow, down, or malformed: the draft is already correct

    if not text or _invents_a_number(text, facts, draft):
        return None
    return text


# ── Route ────────────────────────────────────────────────────────────────────

@router.post("/handover", response_model=HandoverBrief)
def write_handover(facts: HandoverFacts) -> HandoverBrief:
    """
    Word the posted shift facts as a short brief. Always 200 with usable text:
    the template is the floor, Claude only ever replaces the wording.
    """
    draft = _template(facts)
    worded = _word_it(facts, draft)
    return HandoverBrief(
        text=worded or draft,
        model=ANTHROPIC_MODEL if worded else "offline-template",
        generated_at=datetime.now(timezone.utc).isoformat(),
    )
