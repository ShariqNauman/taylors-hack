"""
predict.py - The only scoring entry point. Other code calls predict(features) -> fight probability.

MODE = "model": use violence_model.joblib (trained by train.py)
MODE = "rules": simple hand-written rule (fast wrists + people closing in), no model needed
"""
import math
from pathlib import Path

import joblib
import pandas as pd

# ---------------- Tunable constants ----------------
MODE = "model"                   # "model" or "rules"
MODEL_PATH = Path("violence_model.joblib")
# Rule mode: each part scores 0..1 between its "calm" and "fight" value, then they are combined.
RULE_WRIST_SPEED = (2.0, 8.0)    # torso lengths / s
RULE_CLOSING_SPEED = (0.0, 1.5)  # torso lengths / s (positive = approaching)
RULE_MAX_DIST = 2.5              # people further apart than this (torso lengths) can't be fighting
RULE_WRIST_WEIGHT = 0.7          # rest of the weight goes to closing speed
# ---------------------------------------------------

_bundle = None


def _ramp(value, lo, hi):
    if value is None or math.isnan(value):
        return 0.0
    return min(max((value - lo) / (hi - lo), 0.0), 1.0)


def _rules(f: dict) -> float:
    dist = f.get("min_torso_dist", math.nan)
    if math.isnan(dist) or dist > RULE_MAX_DIST:
        return 0.0
    wrist = _ramp(f.get("max_wrist_speed"), *RULE_WRIST_SPEED)
    closing = _ramp(f.get("closing_speed"), *RULE_CLOSING_SPEED)
    return RULE_WRIST_WEIGHT * wrist + (1 - RULE_WRIST_WEIGHT) * closing


def predict(features: dict) -> float:
    """features: dict from features.compute_features(). Returns fight probability 0..1."""
    global _bundle
    if MODE == "rules":
        return _rules(features)
    if _bundle is None:
        # joblib = pickle: only load model files you made yourself with train.py.
        _bundle = joblib.load(MODEL_PATH)
    X = pd.DataFrame([features])[_bundle["features"]].astype(float)
    return float(_bundle["model"].predict_proba(X)[0, 1])
