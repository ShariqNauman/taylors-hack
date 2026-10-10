"""Web Push signing (api/services/webpush.py). Needs the API's requirements: python api/test_webpush.py"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
import jwt  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402

from api.services import webpush  # noqa: E402


def test_vapid_header_verifies_with_the_public_key():
    pub, priv = webpush.generate_keys()
    assert len(webpush.b64u_dec(pub)) == 65 and len(webpush.b64u_dec(priv)) == 32
    h = webpush.vapid_headers("https://fcm.googleapis.com/fcm/send/abc", pub, priv, "mailto:a@b.c", now=1_000_000)
    assert h["Urgency"] == "high" and h["Content-Length"] == "0"
    token = h["Authorization"].split("t=")[1].split(",")[0]
    assert h["Authorization"].endswith(f"k={pub}")
    key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), webpush.b64u_dec(pub))
    claims = jwt.decode(token, key, algorithms=["ES256"], audience="https://fcm.googleapis.com",
                        options={"verify_exp": False})
    assert claims["sub"] == "mailto:a@b.c" and claims["exp"] == 1_000_000 + 12 * 3600


if __name__ == "__main__":
    test_vapid_header_verifies_with_the_public_key()
    print("ok test_vapid_header_verifies_with_the_public_key")
