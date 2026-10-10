"""
finalize_model.py - Step 5 of TRAINING_PLAN.md, after the ensemble won on the hold-out:
  1. retrain LightGBM (trial 94 settings and weights) on ALL clips -> violence_model.joblib
     (the 1D-CNN on all clips, seq_model.onnx, comes from seq_final.py on the GPU server)
  2. write proof.json and metrics_v2.json with the HOLD-OUT numbers as the official results

Usage:  python finalize_model.py
"""
import json
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

import train as T
from evaluate_holdout import fit
from features import FEATURE_NAMES

# ---------------- Tunable constants ----------------
BEST_LGBM = Path("best_lgbm.json")
HOLDOUT_JSON = Path("holdout_results.json")
HOLDOUT_CLIPS = Path("holdout_clips.csv")
CANDIDATES = Path("candidates.json")
MODEL_OUT = Path("violence_model.joblib")
PROOF_OUT = Path("proof.json")
METRICS_OUT = Path("metrics_v2.json")
PHONE = ["RLVS", "AIRTLab"]
CCTV = ["SCF", "SCVD"]
POSE_MS = 22             # measured: pose + tracking ~45 fps on the Intel GPU
INPUT_MS = 13            # measured: seq_features.window_inputs (features + sequence, one shared pass)
MODEL_MS = 1             # measured: LightGBM 0.6 ms + 1D-CNN 0.1 ms (OpenVINO CPU)
V3_DOMAIN_ROW = {"auc": 0.709, "precision": 0.803, "recall": 0.317}   # REPORT A7.8: trained without CCTV
# ---------------------------------------------------


def row(clips, fight_at):
    hit = clips["sustained"] >= fight_at
    tp, fp = int((hit & (clips["label"] == 1)).sum()), int((hit & (clips["label"] == 0)).sum())
    fn = int((~hit & (clips["label"] == 1)).sum())
    return {"datasets": sorted(clips["dataset"].unique()), "n_clips": len(clips), "auc": round(T.auc(clips), 3),
            "precision": round(tp / max(tp + fp, 1), 3), "recall": round(tp / max(tp + fn, 1), 3)}


def main():
    warnings.filterwarnings("ignore", category=UserWarning)
    best = json.loads(BEST_LGBM.read_text())["settings"]
    hold = json.loads(HOLDOUT_JSON.read_text())

    # ---- 1. Final LightGBM on all clips ----
    videos = pd.read_csv(T.VIDEOS_CSV)
    win = T.load_windows(videos)
    model = fit(win, FEATURE_NAMES, best)
    th = hold["thresholds"]
    joblib.dump({"model": model, "features": FEATURE_NAMES, "name": "lightgbm v4 (trial 94, all clips)",
                 "params": best, "fight_at": {"ensemble": th["ensemble"], "lgbm": th["LightGBM alone"]},
                 "holdout": hold["results"]["LightGBM alone"]}, MODEL_OUT)
    print(f"Saved {MODEL_OUT}: LightGBM on {videos['path'].nunique()} clips, {len(win)} windows")

    # ---- 2. Official numbers = hold-out ----
    clips = pd.read_csv(HOLDOUT_CLIPS)
    ens = clips[clips["model"] == "ensemble"]
    fa = th["ensemble"]
    phone, cctv = row(ens[ens["dataset"].isin(PHONE)], fa), row(ens[ens["dataset"].isin(CCTV)], fa)
    hugs = ens[(ens["dataset"] == "AIRTLab") & (ens["label"] == 0)]
    r = hold["results"]["ensemble"]
    proof = {
        "datasets": sorted(videos["dataset"].unique()), "n_clips": int(hold["n_clips"]),
        "clip_auc": phone["auc"], "clip_precision": phone["precision"], "clip_recall": phone["recall"],
        "cctv_domain": {k: cctv[k] for k in ("datasets", "auc", "precision", "recall")},
        "live_precision": None, "live_recall": None,          # need a labelled session on our camera
        "fa_per_camera_hour": None, "own_footage_minutes": 0,
        "airtlab_fp_rate": round(float((hugs["sustained"] >= fa).mean()), 3),
        "lead_time_s": [],                                     # need recorded escalation clips
        "pushes_per_shift_target": 3,
        "latency_ms": POSE_MS + INPUT_MS + MODEL_MS,
        "ir_check": {"frames": 0, "skeletons_detected": 0, "note": "not run yet", "image": ""},
        "model_card": {
            "inputs": "17 keypoints + person box from YOLO26n-pose + ByteTrack (no video stored; face points "
                      "only as head position)",
            "windows": "last 2 s at 10 fps, scored every 0.5 s; torso-scaled, pair-centred",
            "classifier": ("ensemble: average of LightGBM (23 hand-made features) and a 51k-parameter 1D-CNN "
                           f"over the active pair's keypoint sequence; weights {best}"),
            "split": ("15% of groups locked as a hold-out (stratified by dataset and kind) and evaluated once; "
                      "tuning by GroupKFold on the other 85%; AIRTLab camera pairs kept together"),
            "threshold": (f"alarm when the smoothed score (alpha {T.LIVE['SMOOTH_ALPHA']}) stays >= {fa} for "
                          f"{T.LIVE['MIN_DURATION']} s; FIGHT_AT fixed on the training part at 9% normal-clip "
                          "false alarms, not yet tuned on own footage"),
            "failure_modes": [
                f"hugs and close contact: {len(hugs)} hold-out hug/clap clips, "
                f"{int((hugs['sustained'] >= fa).sum())} raised an alarm",
                "very short clips (SCF, ~2 s) can't hold the 1 s alarm persistence",
                "small or distant people on CCTV: pair features often missing",
                "weapons are not recognised as objects; only the body motion is scored",
                "night / IR footage untested"],
        },
        "disclosure": (
            f"Official numbers are from a hold-out set of {hold['n_clips']} clips that no tuning, threshold or "
            "model choice ever saw. clip_* = RLVS + AIRTLab hold-out clips; cctv_domain = SCF + SCVD hold-out "
            "clips. The final model also trains on other SCF/SCVD clips, so that row is not a pure domain test: "
            f"the earlier model trained without any CCTV scored AUC {V3_DOMAIN_ROW['auc']} on CCTV. Dataset "
            "clips are 2-5 s long, so false alarms per camera-hour are not measured yet; live-room numbers come "
            "from our own labelled footage. Practice-run lesson: 100% on KTH, zero live until retuned. We detect "
            "physical aggression from body motion only; we do not claim verbal or online bullying, weapon "
            "recognition, or night vision."),
        "note": ("partly placeholder: dataset numbers are real (hold-out); live_precision/recall, "
                 "fa_per_camera_hour, lead_time_s and ir_check need own-venue footage"),
    }
    PROOF_OUT.write_text(json.dumps(proof, indent=2, default=float))
    METRICS_OUT.write_text(json.dumps({
        "official": "hold-out", "holdout": hold, "holdout_rows": {"phone": phone, "cctv": cctv},
        "cross_validation_training_part": json.loads(CANDIDATES.read_text()),
        "lgbm_settings": best, "fight_at": th}, indent=2, default=float))
    print(f"Saved {PROOF_OUT}, {METRICS_OUT}")
    print(f"Hold-out (ensemble): AUC {r['clip_auc']}, phone {phone}, cctv {cctv}, "
          f"hugs {int((hugs['sustained'] >= fa).sum())}/{len(hugs)}")


if __name__ == "__main__":
    main()
