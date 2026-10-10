"""
EarlyEye — Master Seed Runner

Executes all seed scripts in correct relational order:
1. seed_site: creates site, zones, cameras, staff
2. seed_proof: creates initial baseline proof record
3. seed_history: creates 350+ realistic incidents with planted patterns

Run:
    python -m api.seed.run_all
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from api.seed.seed_history import seed as seed_history
from api.seed.seed_proof import seed as seed_proof
from api.seed.seed_site import seed as seed_site


def run_all():
    print("========================================")
    print("🚀 EarlyEye: Starting Full Database Seed")
    print("========================================")

    print("\n[Step 1/3] Seeding Site, Zones, Cameras & Staff...")
    seed_site()

    print("\n[Step 2/3] Seeding Baseline Proof Data...")
    seed_proof()

    print("\n[Step 3/3] Seeding 8-Week History (350+ events with demo hotspots)...")
    seed_history()

    print("\n========================================")
    print("🎉 All seeds executed successfully!")
    print("========================================")


if __name__ == "__main__":
    run_all()
