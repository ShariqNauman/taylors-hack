"""
EarlyEye — Seed initial Proof metrics record into Supabase.

Matches the Proof contract in earlyeye-TEAM-FINAL.md §6 and Kayla's frontend types.
Contains realistic baseline values with `note: 'placeholder'` so the frontend proof
page renders immediately. When ML finishes training, they update this row.

Run:
    python -m api.seed.seed_proof
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from api.db import get_supabase

DEFAULT_PROOF_DATA = {
    "datasets": ["RLVS (1,000 violent / 1,000 non-violent)", "AIRTLab hard negatives (hugs, clapping)"],
    "n_clips": 2000,
    "clip_auc": 0.89,
    "clip_precision": 0.86,
    "clip_recall": 0.84,
    "cctv_domain": {
        "datasets": ["Surveillance Camera Fight (SCVD)", "Public CCTV violence"],
        "auc": 0.81,
        "precision": 0.78,
        "recall": 0.76,
    },
    "live_precision": 0.82,
    "live_recall": 0.80,
    "fa_per_camera_hour": 0.8,
    "own_footage_minutes": 30.0,
    "airtlab_fp_rate": 0.04,
    "lead_time_s": [5.2, 6.1, 5.8, 6.4, 5.5],
    "pushes_per_shift_target": 3,
    "latency_ms": 38.0,
    "ir_check": {
        "frames": 3,
        "skeletons_detected": 3,
        "note": "YOLO26n-pose detects coarse upper-body skeletons on greyscale IR; fine wrist tracking degrades under high noise.",
        "image": "/ir-frame.jpg",
    },
    "model_card": {
        "inputs": "Ultralytics YOLO26n-pose (17 COCO keypoints) + BoT-SORT tracker",
        "windows": "1.0s window, 0.5s stride; normalized by torso length (mid-hip to mid-shoulder)",
        "classifier": "RandomForest (200 trees, balanced class weights) + rule-based type head",
        "split": "Video-level GroupKFold (5-fold) — windows from the same video never cross train/val",
        "threshold": "Calibrated on 30 min of venue normal footage targeting <= 1.0 false alarm / camera-hour",
        "failure_modes": [
            "Severe camera motion / handheld shake",
            "Heavy occlusion in dense crowds (> 8 people)",
            "High camera angle with foreshortening reducing torso scale below 25px",
        ],
    },
    "disclosure": (
        "Dataset scores reflect public clip benchmarks (RLVS, AIRTLab). "
        "Live room performance was tuned specifically for the demonstration environment. "
        "We do not claim verbal or cyberbullying detection; the system identifies physical aggression and crowding dynamics."
    ),
    "note": "placeholder",
}


def seed():
    sb = get_supabase()
    print("Seeding initial proof record into proof table...")

    row = {
        "id": 1,
        "data": DEFAULT_PROOF_DATA,
    }

    sb.table("proof").upsert(row, on_conflict="id").execute()
    print("✅ Proof seed complete! (Marked with note: 'placeholder')")


if __name__ == "__main__":
    seed()
