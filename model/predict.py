"""
predict.py - The only scoring entry point. Other code calls predict(features, sequence) -> fight probability.

MODE = "ensemble": average of LightGBM (violence_model.joblib) and the 1D-CNN (seq_model.onnx, OpenVINO)
MODE = "lgbm":     LightGBM alone (fallback; needs no sequence input)
MODE = "rules":    simple hand-written rule (fast wrists + people closing in), no model needed
Each mode has its own FIGHT_AT in live_detector.py (FIGHT_AT_BY_MODE).
"""
import math
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

# ---------------- Tunable constants ----------------
MODE = "ensemble"                # "ensemble", "lgbm" or "rules"
MODEL_PATH = Path("violence_model.joblib")
SEQ_MODEL_PATH = Path("seq_model.onnx")
SEQ_CLIP_PATH = Path("seq_clip.json")   # x, y range the CNN was trained on (clipped the same way here)
SEQ_DEVICE = "CPU"               # the CNN takes ~0.1 ms on CPU; the Intel GPU is busy with pose
# Rule mode: each part scores 0..1 between its "calm" and "fight" value, then they are combined.
RULE_WRIST_SPEED = (2.0, 8.0)    # torso lengths / s
RULE_CLOSING_SPEED = (0.0, 1.5)  # torso lengths / s (positive = approaching)
RULE_MAX_DIST = 2.5              # people further apart than this (torso lengths) can't be fighting
RULE_WRIST_WEIGHT = 0.7          # rest of the weight goes to closing speed
# ---------------------------------------------------

NEEDS_SEQUENCE = MODE == "ensemble"   # live_detector builds the sequence input only when needed
_bundle, _seq, _seq_clip = None, None, None


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


def _lgbm(features: dict) -> float:
    global _bundle
    if _bundle is None:
        # joblib = pickle: only load model files you made yourself with finalize_model.py / train.py.
        _bundle = joblib.load(MODEL_PATH)
    X = pd.DataFrame([features])[_bundle["features"]].astype(float)
    if "clip" in _bundle:  # same 1st-99th percentile clipping as training: out-of-range values can't spike
        lo = pd.Series({f: r[0] for f, r in _bundle["clip"].items()})
        hi = pd.Series({f: r[1] for f, r in _bundle["clip"].items()})
        X = X.clip(lower=lo, upper=hi, axis=1)
    return float(_bundle["model"].predict_proba(X)[0, 1])


def _cnn(sequence: np.ndarray) -> float:
    global _seq, _seq_clip
    if _seq is None:
        import json
        import openvino as ov
        _seq = ov.Core().compile_model(str(SEQ_MODEL_PATH), SEQ_DEVICE)
        _seq_clip = json.loads(SEQ_CLIP_PATH.read_text()) if SEQ_CLIP_PATH.exists() else None
    x = sequence[None].astype(np.float32)
    if _seq_clip:
        np.clip(x[..., :2], _seq_clip["lo"], _seq_clip["hi"], out=x[..., :2])
    logit = float(np.asarray(_seq(x)[0]).ravel()[0])
    return 1.0 / (1.0 + math.exp(-logit))


def predict(features: dict, sequence: np.ndarray = None) -> float:
    """features: dict from features.compute_features(); sequence: seq_features array (ensemble only).
    Returns fight probability 0..1."""
    if MODE == "rules":
        return _rules(features)
    p = _lgbm(features)
    if MODE == "ensemble":
        if sequence is None:
            raise ValueError("MODE 'ensemble' needs the sequence input (seq_features.window_inputs)")
        p = (p + _cnn(sequence)) / 2
    return p
