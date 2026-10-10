"""Print a VAPID key pair for Web Push. Paste the three lines into Render's environment.
Run from the repo root:  python -m api.scripts.gen_vapid"""
from api.services.webpush import generate_keys

if __name__ == "__main__":
    pub, priv = generate_keys()
    print(f"VAPID_PUBLIC_KEY={pub}")
    print(f"VAPID_PRIVATE_KEY={priv}")
    print("VAPID_SUBJECT=mailto:you@your-school.edu.my")
