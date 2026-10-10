"""
Web Push for the guard app: the alarm reaches the guard's phone even when EarlyEye is closed.

Payload-less push (RFC 8030 + VAPID, RFC 8292): the API signs a short JWT with its VAPID key and
POSTs an empty message to the phone's push endpoint. The phone's service worker wakes up, fetches
the guard's newest alert from GET /events, and shows the notification. No message encryption is
needed because nothing is sent in the push itself.

Keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (base64url, as printed by api/scripts/gen_vapid.py),
set in Render. Without them, push is off and everything else works.
"""

from __future__ import annotations

import base64
import time
from urllib.parse import urlparse

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from api.config import VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_SUBJECT


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def b64u_dec(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def enabled() -> bool:
    return bool(VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)


def generate_keys() -> tuple[str, str]:
    """(public, private) as base64url: the uncompressed P-256 point and the 32-byte scalar."""
    k = ec.generate_private_key(ec.SECP256R1())
    d = k.private_numbers().private_value.to_bytes(32, "big")
    pub = k.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    return b64u(pub), b64u(d)


def vapid_headers(endpoint: str, public_key: str, private_key: str, subject: str,
                  now: float | None = None) -> dict[str, str]:
    u = urlparse(endpoint)
    key = ec.derive_private_key(int.from_bytes(b64u_dec(private_key), "big"), ec.SECP256R1())
    token = jwt.encode(
        {"aud": f"{u.scheme}://{u.netloc}", "exp": int((now or time.time()) + 12 * 3600), "sub": subject},
        key,
        algorithm="ES256",
    )
    return {
        "Authorization": f"vapid t={token}, k={public_key}",
        "TTL": "120",          # an alarm older than 2 minutes is not worth waking a phone for
        "Urgency": "high",
        "Content-Length": "0",
    }


async def send(endpoint: str) -> int:
    """POST an empty push. Returns the push service's status (201 = accepted, 404/410 = gone)."""
    headers = vapid_headers(endpoint, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT)
    async with httpx.AsyncClient(timeout=5) as c:
        r = await c.post(endpoint, headers=headers)
        return r.status_code
