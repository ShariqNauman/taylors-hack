"""
train.py - Build feature windows from keypoints_v2/, train LightGBM with GroupKFold by group,
report clip-level results, and keep the better of the new model and the old one.

Windows: every STEP_S, features from the last 2 s resampled to FEATURE_FPS (features.window_features).
Clip score = highest window score in the clip.
Sample weights per dataset (DATASET_WEIGHT): acted AIRTLab 3x, CCTV (SCF, SCVD) 2x, RLVS 1x.

Report:
  - out-of-fold clip ROC-AUC, overall and per dataset (GroupKFold, so no clip is scored by a model
    that saw it, and AIRTLab cam1/cam2 of one scene stay together)
  - clips above FIGHT_AT per dataset and kind: peak raw window score, and whether the live logic
    (smoothing + MIN_DURATION, from live_detector.py) would show FIGHT
  - leave-one-dataset-out: train on the other datasets, test on the held-out one
  - the old model (OLD_MODEL) on the same windows
  - the two Proof-page rows (team rule: report both):
      phone-video sets  RLVS + AIRTLab, out-of-fold (GroupKFold)
      CCTV domain       trained on RLVS + AIRTLab only, tested on held-out SCF + SCVD
    with clip precision / recall, where a clip counts as "alarmed" when the live logic raises an alarm:
    smoothed score >= FIGHT_AT held for MIN_DURATION (team rule: alarms need 1 s of persistence)
Saves the new model to MODEL_OUT only if it beats the old model, metrics to METRICS_OUT and the
Proof-page numbers to PROOF_OUT (served by the backend at GET /proof).

Usage:  python train.py            # uses whatever keypoints exist so far; reruns add new videos
"""
import hashlib
import json
import time
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold
from tqdm import tqdm

from features import FEATURE_NAMES, LONG_S, SHORT_S, window_features
from tune_live import current_settings, replay

# ---------------- Tunable constants ----------------
VIDEOS_CSV = Path("videos.csv")
KEYPOINT_DIR = Path("keypoints_v2")
WINDOWS_CACHE = Path("windows_v2.csv")   # per-window features; rebuilt for videos whose features changed
MODEL_OUT = Path("violence_model.joblib")
OLD_MODEL = Path("violence_model_backup_v1.joblib")
METRICS_OUT = Path("metrics_v2.json")
PROOF_OUT = Path("proof.json")            # backend serves this at GET /proof
PHONE_DATASETS = ["RLVS", "AIRTLab"]      # "phone-video sets" row on the Proof page
CCTV_DATASETS = ["SCF", "SCVD"]           # held-out CCTV-domain row
POSE_MS = 22             # measured: pose + tracking ~45 fps on the Intel GPU (REPORT.md A7.7)
FEATURE_MS = 15          # measured: features.window_features per scored window
STEP_S = 0.5             # one window every 0.5 s
DATASET_WEIGHT = {"AIRTLab": 3.0, "SCF": 2.0, "SCVD": 2.0, "RLVS": 1.0, "Own": 3.0}
N_FOLDS = 5
SEED = 42
DEFAULT_PARAMS = dict(n_estimators=300, learning_rate=0.05, num_leaves=15, min_child_samples=20)
TUNE_GRID = dict(num_leaves=[7, 15, 31, 63], learning_rate=[0.02, 0.05, 0.1],
                 n_estimators=[100, 200, 400, 800], min_child_samples=[10, 20, 50, 100])
N_TUNE = 12              # random LightGBM settings tried (best by out-of-fold clip ROC-AUC)
SUSPICIOUS_AUC = 0.97    # warn about possible leakage above this clip ROC-AUC
# ---------------------------------------------------

LIVE = current_settings()  # SMOOTH_ALPHA, TENSE_AT, FIGHT_AT, MIN_DURATION from live_detector.py
FIGHT_HOLD = 2.0
FEATURES_HASH = hashlib.md5(Path("features.py").read_bytes()).hexdigest()[:8]


def make_model(params):
    return LGBMClassifier(**params, subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
                          random_state=SEED, verbose=-1)


def kp_path(video_path):
    """data/<...>/clip.mp4 -> keypoints_v2/<...>/clip.csv (same rule as extract_keypoints_v2.py)."""
    return KEYPOINT_DIR / Path(video_path).relative_to("data").with_suffix(".csv")


def video_windows(v):
    """Feature rows for one video: one window every STEP_S from SHORT_S to just past the last frame."""
    kp = pd.read_csv(kp_path(v["path"]))
    tmax = kp["time_s"].max() if len(kp) else SHORT_S
    rows = []
    for end in np.arange(SHORT_S, max(tmax, SHORT_S) + 0.1 + 1e-6, STEP_S):
        # Only frames up to `end`: live never sees the future.
        f = window_features(kp[(kp["time_s"] > end - LONG_S - 0.1) & (kp["time_s"] <= end)], end)
        f.update(path=v["path"], end_s=round(end, 2))
        rows.append(f)
    return rows


def load_windows(videos):
    """Cached windows for videos already done with the current features.py; compute the rest."""
    cache = pd.read_csv(WINDOWS_CACHE) if WINDOWS_CACHE.exists() else pd.DataFrame()
    if len(cache):
        cache = cache[(cache["feat_hash"] == FEATURES_HASH) & cache["path"].isin(videos["path"])]
    todo = videos[~videos["path"].isin(set(cache["path"]) if len(cache) else set())]
    if len(todo):
        rows = [r for _, v in tqdm(todo.iterrows(), total=len(todo), desc="features", unit="video")
                for r in video_windows(v)]
        new = pd.DataFrame(rows).assign(feat_hash=FEATURES_HASH)
        cache = pd.concat([cache, new], ignore_index=True)
        cache.to_csv(WINDOWS_CACHE, index=False)
    meta = videos[["path", "dataset", "label", "kind", "domain", "group_id"]]
    return cache.drop(columns="feat_hash").merge(meta, on="path").sort_values(["path", "end_s"],
                                                                                 ignore_index=True)


def oof_scores(win, feats, params, weights=None):
    """Out-of-fold window scores, GroupKFold by group_id."""
    X, y, g = win[feats], win["label"].to_numpy(), win["group_id"].to_numpy()
    oof = np.zeros(len(win))
    for tr, te in GroupKFold(n_splits=N_FOLDS).split(X, y, g):
        assert not set(g[tr]) & set(g[te]), "group leaked across folds!"
        w = None if weights is None else weights[tr]
        oof[te] = make_model(params).fit(X.iloc[tr], y[tr], sample_weight=w).predict_proba(X.iloc[te])[:, 1]
    return oof


def clip_table(win, p):
    """One row per clip: peak raw window score, and whether the live logic raises an alarm
    (smoothed score >= FIGHT_AT held for MIN_DURATION; team rule: alarms need 1 s of persistence)."""
    rows = []
    for path, g in win.assign(p=p).groupby("path", sort=False):
        levels = replay(g["p"], g["end_s"], LIVE["SMOOTH_ALPHA"], LIVE["TENSE_AT"], LIVE["FIGHT_AT"],
                        LIVE["MIN_DURATION"], FIGHT_HOLD)
        rows.append({"path": path, "dataset": g["dataset"].iloc[0], "kind": g["kind"].iloc[0],
                     "label": g["label"].iloc[0], "peak": g["p"].max(), "live_fight": "FIGHT" in levels})
    return pd.DataFrame(rows)


def auc(clips):
    return roc_auc_score(clips["label"], clips["peak"]) if clips["label"].nunique() == 2 else np.nan


def proof_row(clips):
    """Clip AUC, precision and recall of the live alarm (1 s persistence)."""
    tp = int((clips["live_fight"] & (clips["label"] == 1)).sum())
    fp = int((clips["live_fight"] & (clips["label"] == 0)).sum())
    fn = int((~clips["live_fight"] & (clips["label"] == 1)).sum())
    return {"datasets": sorted(clips["dataset"].unique()), "n_clips": len(clips), "auc": round(auc(clips), 3),
            "precision": round(tp / max(tp + fp, 1), 3), "recall": round(tp / max(tp + fn, 1), 3)}


def summary(clips):
    """Clip AUC overall + per dataset, and % of clips over FIGHT_AT per dataset and kind."""
    out = {"auc_all": auc(clips), "auc": {d: auc(c) for d, c in clips.groupby("dataset")}}
    by_kind = clips.groupby(["dataset", "kind", "label"]).agg(
        clips=("path", "size"),
        peak_over=("peak", lambda s: int((s >= LIVE["FIGHT_AT"]).sum())),
        live_fight=("live_fight", "sum")).reset_index()
    out["by_kind"] = by_kind
    return out


def print_kinds(by_kind, title):
    t = by_kind.copy()
    t["peak >= FIGHT_AT"] = [f"{o}/{n} ({100 * o / n:.0f}%)" for o, n in zip(t["peak_over"], t["clips"])]
    t["live FIGHT"] = [f"{int(o)}/{n} ({100 * o / n:.0f}%)" for o, n in zip(t["live_fight"], t["clips"])]
    print(f"\n{title}")
    print(t[["dataset", "kind", "label", "peak >= FIGHT_AT", "live FIGHT"]].to_string(index=False))


def main():
    warnings.filterwarnings("ignore", category=UserWarning)
    start = time.time()
    videos = pd.read_csv(VIDEOS_CSV)
    videos = videos[[kp_path(p).exists() for p in videos["path"]]].reset_index(drop=True)
    print(f"{len(videos)} videos with v2 keypoints:")
    print(videos.groupby(["dataset", "label"]).size().unstack(fill_value=0).to_string())
    print(f"Live logic from live_detector.py: {LIVE}")

    win = load_windows(videos)
    weights = win["dataset"].map(DATASET_WEIGHT).fillna(1.0).to_numpy()
    print(f"\n{len(win)} windows, {win['label'].mean():.0%} fight")
    print("Missing rate per feature:", win[FEATURE_NAMES].isna().mean().round(2).to_dict())

    # ---- Tune LightGBM (out-of-fold clip AUC over all datasets) ----
    rng = np.random.default_rng(SEED)
    combos = [DEFAULT_PARAMS]
    while len(combos) < N_TUNE:
        c = {k: v[int(rng.integers(len(v)))] for k, v in TUNE_GRID.items()}
        if c not in combos:
            combos.append(c)
    tune = []
    for c in tqdm(combos, desc="tuning", unit="setting"):
        tune.append((auc(clip_table(win, oof_scores(win, FEATURE_NAMES, c, weights))), c))
    best_auc, params = max(tune, key=lambda x: x[0])
    params = {k: (float(v) if k == "learning_rate" else int(v)) for k, v in params.items()}
    print(f"\nBest of {len(combos)} settings: {params} (clip AUC {best_auc:.3f}, slightly optimistic)")

    # ---- New model, out-of-fold ----
    new_clips = clip_table(win, oof_scores(win, FEATURE_NAMES, params, weights))
    new = summary(new_clips)

    # ---- Old model on the same windows (it was trained on 600 RLVS clips, never on the others) ----
    old = None
    if OLD_MODEL.exists():
        bundle = joblib.load(OLD_MODEL)  # our own file from the previous train.py
        old_clips = clip_table(win, bundle["model"].predict_proba(win[bundle["features"]].astype(float))[:, 1])
        old = summary(old_clips)

    # ---- Leave one dataset out ----
    lodo = {}
    for d in sorted(win["dataset"].unique()):
        tr, te = win["dataset"] != d, win["dataset"] == d
        if win.loc[tr, "label"].nunique() < 2:
            continue
        m = make_model(params).fit(win.loc[tr, FEATURE_NAMES], win.loc[tr, "label"], sample_weight=weights[tr])
        lodo[d] = summary(clip_table(win[te], m.predict_proba(win.loc[te, FEATURE_NAMES])[:, 1]))

    # ---- Proof-page rows (team rule: report both) ----
    phone = win["dataset"].isin(PHONE_DATASETS).to_numpy()
    cctv = win["dataset"].isin(CCTV_DATASETS).to_numpy()
    pw = win[phone].reset_index(drop=True)
    phone_clips = clip_table(pw, oof_scores(pw, FEATURE_NAMES, params, weights[phone]))
    m = make_model(params).fit(win.loc[phone, FEATURE_NAMES], win.loc[phone, "label"], sample_weight=weights[phone])
    cctv_clips = clip_table(win[cctv], m.predict_proba(win.loc[cctv, FEATURE_NAMES])[:, 1])
    rows = {"phone-video sets, out-of-fold": proof_row(phone_clips),
            "CCTV domain, held out (trained on RLVS + AIRTLab only)": proof_row(cctv_clips),
            "CCTV, out-of-fold with CCTV in training (shipped model)":
                proof_row(new_clips[new_clips["dataset"].isin(CCTV_DATASETS)]),
            "all datasets, out-of-fold (shipped model)": proof_row(new_clips)}

    # ---- Report ----
    print(f"\n=== Clip ROC-AUC (clip score = max window) ===")
    table = pd.DataFrame({"new (out-of-fold)": {"ALL": new["auc_all"], **new["auc"]}})
    table["new, dataset held out"] = pd.Series({d: s["auc_all"] for d, s in lodo.items()})
    if old:
        table["old model"] = pd.Series({"ALL": old["auc_all"], **old["auc"]})
    print(table.round(3).to_string())
    print(f"FIGHT_AT = {LIVE['FIGHT_AT']}. 'live FIGHT' = smoothing {LIVE['SMOOTH_ALPHA']}, "
          f"held >= {LIVE['MIN_DURATION']} s.")
    print_kinds(new["by_kind"], "New model, out-of-fold:")
    for d, s in lodo.items():
        print_kinds(s["by_kind"], f"New model, trained WITHOUT {d}, tested on {d}:")
    if old:
        print_kinds(old["by_kind"], "Old model (RLVS rows partly in-sample: it trained on 600 of them):")
    print(f"\n=== Proof-page rows (alarm = smoothed >= {LIVE['FIGHT_AT']} held {LIVE['MIN_DURATION']} s) ===")
    print(pd.DataFrame(rows).T[["n_clips", "auc", "precision", "recall"]].to_string())
    if new["auc_all"] >= SUSPICIOUS_AUC:
        print(f"!!! WARNING: clip AUC {new['auc_all']:.3f} is suspiciously high. Check for leakage.")

    # ---- Keep the better model ----
    final = make_model(params).fit(win[FEATURE_NAMES], win["label"], sample_weight=weights)
    imp = pd.Series(final.booster_.feature_importance("gain"), index=FEATURE_NAMES)
    print("\nFeature importance (share of gain):")
    print((imp / imp.sum()).sort_values(ascending=False).round(3).to_string())
    old_auc = old["auc_all"] if old else 0.0
    keep_new = new["auc_all"] > old_auc
    if keep_new:
        joblib.dump({"model": final, "features": FEATURE_NAMES, "name": "lightgbm v2", "params": params,
                     "clip_auc": new["auc_all"], "datasets": sorted(win["dataset"].unique()),
                     "weights": DATASET_WEIGHT}, MODEL_OUT)
        print(f"\nNew model beats the old one ({new['auc_all']:.3f} vs {old_auc:.3f}): saved to {MODEL_OUT}")
    else:
        print(f"\nOld model is better ({old_auc:.3f} vs {new['auc_all']:.3f}): {MODEL_OUT} not changed")

    to_json = lambda s: {"auc_all": s["auc_all"], "auc": s["auc"], "by_kind": s["by_kind"].to_dict("records")}
    METRICS_OUT.write_text(json.dumps({
        "n_videos": len(videos), "params": params, "weights": DATASET_WEIGHT, "live": LIVE,
        "new_oof": to_json(new), "lodo": {d: to_json(s) for d, s in lodo.items()},
        "old": to_json(old) if old else None, "kept": "new" if keep_new else "old",
        "importance": (imp / imp.sum()).round(4).to_dict(), "proof_rows": rows}, indent=2, default=float))
    print(f"Metrics: {METRICS_OUT}")

    # ---- proof.json for GET /proof (shape = Proof type in docs/kayla-frontend-plan.md) ----
    t0 = time.time()
    for _ in range(100):
        final.predict_proba(win[FEATURE_NAMES].iloc[:1])
    predict_ms = (time.time() - t0) * 10
    p_row, c_row = rows["phone-video sets, out-of-fold"], rows["CCTV domain, held out (trained on RLVS + AIRTLab only)"]
    c_incl = rows["CCTV, out-of-fold with CCTV in training (shipped model)"]
    air = phone_clips[(phone_clips["dataset"] == "AIRTLab") & (phone_clips["label"] == 0)]
    proof = {
        "datasets": sorted(win["dataset"].unique()), "n_clips": len(videos),
        "clip_auc": p_row["auc"], "clip_precision": p_row["precision"], "clip_recall": p_row["recall"],
        "cctv_domain": {k: c_row[k] for k in ("datasets", "auc", "precision", "recall")},
        "live_precision": None, "live_recall": None,          # need a labelled session on our camera
        "fa_per_camera_hour": None, "own_footage_minutes": 0,  # same
        "airtlab_fp_rate": round(float(air["live_fight"].mean()), 3),
        "lead_time_s": [],                                     # need 5 recorded escalation clips
        "pushes_per_shift_target": 3,
        "latency_ms": round(POSE_MS + FEATURE_MS + predict_ms),
        "ir_check": {"frames": 0, "skeletons_detected": 0, "note": "not run yet", "image": ""},
        "model_card": {
            "inputs": "12 body keypoints per person from YOLO26n-pose + ByteTrack (no faces, no video stored)",
            "windows": "last 2 s resampled to 10 fps, scored every 0.5 s; distances scaled by torso length",
            "classifier": f"LightGBM {params}, sample weights {DATASET_WEIGHT}",
            "split": "GroupKFold by video (AIRTLab cam1/cam2 of one scene kept together); clip score = max window",
            "threshold": (f"alarm when the smoothed score (alpha {LIVE['SMOOTH_ALPHA']}) stays >= "
                          f"{LIVE['FIGHT_AT']} for {LIVE['MIN_DURATION']} s; tuned on dataset clips, "
                          "not yet on own footage"),
            "failure_modes": [
                f"hugs and close contact: {round(100 * float(air['live_fight'].mean()))}% of AIRTLab hugs/claps raise an alarm",
                "small or distant people on CCTV: pair features often missing",
                "only one person tracked: pair features unavailable",
                "weapons are not detected as objects; only the body motion is scored",
                "night / IR footage untested"],
        },
        "disclosure": (
            f"Dataset numbers: phone-video sets (RLVS + AIRTLab, {p_row['n_clips']} clips, out-of-fold) and a "
            f"held-out CCTV row (SCF + SCVD, {c_row['n_clips']} clips, model trained without them). The shipped "
            f"model also trains on SCF + SCVD; their out-of-fold AUC with CCTV in training is {c_incl['auc']}. "
            "Dataset clips are 2-5 s long, so false alarms per camera-hour are not measured yet; live-room "
            "numbers come from our own labelled footage. Practice-run lesson: 100% on KTH, zero live until "
            "retuned, so we report dataset and live numbers side by side. We detect physical aggression from "
            "body motion only; we do not claim verbal or online bullying, weapon recognition, or night vision."),
        "note": ("partly placeholder: dataset numbers are real; live_precision/recall, fa_per_camera_hour, "
                 "lead_time_s and ir_check need own-venue footage"),
    }
    PROOF_OUT.write_text(json.dumps(proof, indent=2, default=float))
    print(f"Proof: {PROOF_OUT}  (total {(time.time() - start) / 60:.1f} min)")


if __name__ == "__main__":
    main()
