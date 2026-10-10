"""
train.py - Build feature windows from keypoints/, compare model variants with GroupKFold by video,
tune LightGBM, and save the best model.

Windows: every 0.5 s, features from the last 2 s (the "1 s" features use the last 1 s of it).
Own clips (data/own, recorded with record_clips.py) get 3x sample weight and their own groups.

Comparison table (all scored on RLVS clips, same CV folds):
  old 600 model        old 6 features (windows_600_v1.csv), default params
  new features         new features, RLVS only, default params
  + own clips          new features, RLVS + own clips, default params
  tuned                best of N_TUNE random LightGBM settings on the "+ own clips" data

Usage:  python train.py
"""
import time
import warnings
from pathlib import Path

import cv2
import joblib
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.metrics import roc_auc_score, roc_curve
from sklearn.model_selection import GroupKFold
from tqdm import tqdm

from features import FEATURE_NAMES, LONG_S, SHORT_S, compute_features

# ---------------- Tunable constants ----------------
VIDEOS_CSV = Path("videos.csv")
KEYPOINT_DIR = Path("keypoints")
WINDOWS_CACHE = Path("windows.csv")       # delete this file to recompute features
OLD_WINDOWS = Path("windows_600_v1.csv")  # features of the old 600 model, for the comparison row
OLD_FEATURES = ["max_wrist_speed", "max_wrist_accel", "min_torso_dist", "closing_speed",
                "max_arm_extension", "person_count"]
MODEL_OUT = Path("violence_model.joblib")
BASELINE_MODEL = Path("violence_model_600.joblib")  # kept if nothing beats it
STEP_S = 0.5             # one window every 0.5 s
OWN_DATASET = "Own"      # dataset name of data/own clips (see list_videos.py)
OWN_WEIGHT = 3.0         # sample weight of own clips
N_FOLDS = 5
TARGET_FA = 0.20         # report fights caught at about this false-alarm rate (RLVS clips)
SUSPICIOUS_AUC = 0.97    # warn about possible leakage above this clip ROC-AUC
SEED = 42
# Mirrored copies were dropped: every feature is left-right symmetric, so mirrors were exact duplicates.

DEFAULT_PARAMS = dict(n_estimators=300, learning_rate=0.05, num_leaves=15, min_child_samples=20)
TUNE_GRID = dict(num_leaves=[7, 15, 31, 63], learning_rate=[0.02, 0.05, 0.1],
                 n_estimators=[100, 200, 400, 800], min_child_samples=[10, 20, 50, 100])
N_TUNE = 20
# ---------------------------------------------------


def make_model(params):
    return LGBMClassifier(**params, subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
                          random_state=SEED, verbose=-1)


def window_ends(kp):
    """Window end times: every STEP_S from SHORT_S until just past the last frame."""
    tmax = kp["time_s"].max() if len(kp) else SHORT_S
    ends = np.arange(SHORT_S, tmax + 0.1 + 1e-6, STEP_S)
    return ends if len(ends) else np.array([SHORT_S])


def build_windows(videos):
    rows = []
    for _, v in tqdm(videos.iterrows(), total=len(videos), desc="features", unit="video"):
        kp = pd.read_csv(v["kp_path"])
        for end in window_ends(kp):
            f = compute_features(kp[(kp["time_s"] >= end - LONG_S) & (kp["time_s"] < end)], end)
            f.update(path=v["path"], dataset=v["dataset"], label=v["label"],
                     group_id=v["group_id"], end_s=end)
            rows.append(f)
    return pd.DataFrame(rows)


def clip_kind(path, dataset, label):
    """fight / hug / normal for own clips (from the file name), else fight / calm."""
    if dataset == OWN_DATASET:
        return Path(path).stem.split("_")[0]
    return "fight" if label == 1 else "calm"


def oof_scores(win, feats, params, weights=None):
    """Out-of-fold window scores, GroupKFold by video."""
    X, y, g = win[feats], win["label"].to_numpy(), win["group_id"].to_numpy()
    oof = np.zeros(len(win))
    for tr, te in GroupKFold(n_splits=N_FOLDS).split(X, y, g):
        assert not set(g[tr]) & set(g[te]), "video leaked across folds!"
        w = None if weights is None else weights[tr]
        oof[te] = make_model(params).fit(X.iloc[tr], y[tr], sample_weight=w).predict_proba(X.iloc[te])[:, 1]
    return oof


def summarize(win, oof):
    """Clip-level metrics: RLVS AUC, fights caught at ~TARGET_FA, mean scores of own clip kinds."""
    clips = (win.assign(p=oof).groupby("path")
             .agg(p=("p", "max"), label=("label", "first"), dataset=("dataset", "first")).reset_index())
    rl = clips[clips["dataset"] != OWN_DATASET]
    fpr, tpr, thr = roc_curve(rl["label"], rl["p"])
    i = np.where(fpr <= TARGET_FA)[0][-1]
    out = {"clip_auc": roc_auc_score(rl["label"], rl["p"]),
           "caught_at_fa": tpr[i], "fa": fpr[i], "threshold": thr[i]}
    own = clips[clips["dataset"] == OWN_DATASET]
    for kind in ("fight", "hug", "normal"):
        k = own[[clip_kind(p, OWN_DATASET, 0) == kind for p in own["path"]]]
        out[f"own_{kind}"] = k["p"].mean() if len(k) else np.nan
        out[f"n_own_{kind}"] = len(k)
    return out, clips


def main():
    warnings.filterwarnings("ignore", category=UserWarning)
    start = time.time()
    videos = pd.read_csv(VIDEOS_CSV)
    videos["kp_path"] = [KEYPOINT_DIR / d / (Path(p).stem + ".csv")
                         for p, d in zip(videos["path"], videos["dataset"])]
    videos = videos[videos["kp_path"].map(Path.exists)].reset_index(drop=True)
    print(f"{len(videos)} videos with keypoints:", videos.groupby(["dataset", "label"]).size().to_dict())

    # Features are cached; recompute if the video set or the feature list changed.
    win = pd.read_csv(WINDOWS_CACHE) if WINDOWS_CACHE.exists() else None
    if win is None or set(win["path"]) != set(videos["path"]) or not set(FEATURE_NAMES) <= set(win.columns):
        win = build_windows(videos)
        win.to_csv(WINDOWS_CACHE, index=False)
    has_own = (win["dataset"] == OWN_DATASET).any()
    weights = np.where(win["dataset"] == OWN_DATASET, OWN_WEIGHT, 1.0)
    rlvs = win[win["dataset"] != OWN_DATASET].reset_index(drop=True)
    print(f"{len(win)} windows ({len(rlvs)} RLVS, {len(win) - len(rlvs)} own), {win['label'].mean():.0%} fight")
    print("Missing rate per feature:", win[FEATURE_NAMES].isna().mean().round(2).to_dict(), "\n")

    results = {}
    # ---- Row 1: old 600 model (old features, default params), RLVS only ----
    if OLD_WINDOWS.exists():
        old = pd.read_csv(OLD_WINDOWS)
        old = old[old["version"] == "orig"].reset_index(drop=True) if "version" in old else old
        results["old 600 model"] = summarize(old, oof_scores(old, OLD_FEATURES, DEFAULT_PARAMS))[0]
    # ---- Row 2: new features, RLVS only ----
    results["new features"] = summarize(rlvs, oof_scores(rlvs, FEATURE_NAMES, DEFAULT_PARAMS))[0]
    # ---- Row 3: new features + own clips (3x weight) ----
    if has_own:
        results["+ own clips"] = summarize(win, oof_scores(win, FEATURE_NAMES, DEFAULT_PARAMS, weights))[0]

    # ---- Row 4: random search over LightGBM settings on the richest data ----
    data, w = (win, weights) if has_own else (rlvs, None)
    rng = np.random.default_rng(SEED)
    combos = [DEFAULT_PARAMS]
    while len(combos) < N_TUNE:
        c = {k: v[int(rng.integers(len(v)))] for k, v in TUNE_GRID.items()}
        if c not in combos:
            combos.append(c)
    print(f"Tuning: {len(combos)} LightGBM settings x {N_FOLDS} folds...")
    tune_rows = []
    for c in tqdm(combos, unit="setting"):
        s, _ = summarize(data, oof_scores(data, FEATURE_NAMES, c, w))
        tune_rows.append({**c, "clip_auc": s["clip_auc"], "caught_at_fa": s["caught_at_fa"]})
    tune = pd.DataFrame(tune_rows).sort_values("clip_auc", ascending=False)
    print(tune.head(5).round(3).to_string(index=False))
    best_params = {k: tune.iloc[0][k].item() for k in TUNE_GRID}
    best_params = {k: int(v) if k != "learning_rate" else float(v) for k, v in best_params.items()}
    tuned, tuned_clips = summarize(data, oof_scores(data, FEATURE_NAMES, best_params, w))
    results["tuned"] = tuned

    # ---- Comparison table ----
    table = pd.DataFrame(results).T
    show = pd.DataFrame({
        "clip ROC-AUC (RLVS)": table["clip_auc"].round(3),
        f"fights caught @~{TARGET_FA:.0%} FA": [f"{c:.0%} (FA {f:.0%})" for c, f in zip(table["caught_at_fa"], table["fa"])],
        "own fight clips": table["own_fight"].round(2),
        "own hug clips": table["own_hug"].round(2),
        "own normal clips": table["own_normal"].round(2),
    }, index=table.index)
    print(f"\n=== Comparison ({N_FOLDS}-fold GroupKFold by video, clip score = max window; "
          f"own columns = mean clip score) ===")
    print(show.to_string())
    if has_own:
        print(f"Own clips: {int(table['n_own_fight'].iloc[-1])} fight, {int(table['n_own_hug'].iloc[-1])} hug, "
              f"{int(table['n_own_normal'].iloc[-1])} normal")
    else:
        print("No own clips yet (record with record_clips.py), so the own columns are empty.")
    print(f"Note: 'tuned' picks the best of {len(combos)} settings on the same folds, "
          "so its AUC is slightly optimistic.")

    # ---- Leakage and shortcut checks on the tuned variant ----
    heights = {p: cv2.VideoCapture(p).get(cv2.CAP_PROP_FRAME_HEIGHT) for p in tuned_clips["path"]}
    rl = tuned_clips[tuned_clips["dataset"] != OWN_DATASET]
    corr = np.corrcoef(rl["path"].map(heights), rl["p"])[0, 1]
    print(f"\nCorrelation between model score and video height (RLVS): {corr:.2f}")
    if tuned["clip_auc"] >= SUSPICIOUS_AUC:
        print(f"!!! WARNING: clip ROC-AUC {tuned['clip_auc']:.3f} is suspiciously high. Check for leakage.")
    if abs(corr) > 0.3:
        print("!!! WARNING: scores track video resolution (possible shortcut).")

    # ---- Keep the best variant only if it beats the old model ----
    new_rows = {k: v for k, v in results.items() if k != "old 600 model"}
    best_name = max(new_rows, key=lambda k: new_rows[k]["clip_auc"])
    params = best_params if best_name == "tuned" else DEFAULT_PARAMS
    old_auc = results.get("old 600 model", {}).get("clip_auc", 0.0)
    if new_rows[best_name]["clip_auc"] < old_auc:
        print(f"\nNo improvement over the old model ({new_rows[best_name]['clip_auc']:.3f} < {old_auc:.3f}). "
              f"Keeping {BASELINE_MODEL} - restore it with the old features.py before going live.")
        return
    use_own = best_name != "new features" and has_own
    fit_data = win if use_own else rlvs
    fit_w = weights if use_own else None
    final = make_model(params).fit(fit_data[FEATURE_NAMES], fit_data["label"], sample_weight=fit_w)
    imp = pd.Series(final.booster_.feature_importance("gain"), index=FEATURE_NAMES)
    print(f"\nBest: {best_name} with {params}")
    print("Feature importance (share of total gain):")
    print((imp / imp.sum()).sort_values(ascending=False).round(3).to_string())
    joblib.dump({"model": final, "features": FEATURE_NAMES, "name": f"lightgbm ({best_name})",
                 "params": params, "clip_auc": new_rows[best_name]["clip_auc"],
                 "threshold_at_target_fa": new_rows[best_name]["threshold"]}, MODEL_OUT)
    print(f"Saved to {MODEL_OUT}  (total time {(time.time() - start) / 60:.1f} min)")


if __name__ == "__main__":
    main()
