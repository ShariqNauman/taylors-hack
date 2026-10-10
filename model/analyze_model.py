"""
analyze_model.py - Honest diagnostics of the fight model (no files changed).

Uses windows.csv (written by train.py) and the saved model's LightGBM settings.
  1. Cross-validated performance, overall and per resolution band (shortcut check)
  2. Strength of each single feature, and missing-value rates per class
  3. Ablations: feature subsets and rules mode
  4. Learning curve: does more data help?
  5. Live session vs training data (only if the live log has the current features)

Usage:  python analyze_model.py [--live live_features.csv]
"""
import argparse
import warnings

import cv2
import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold

import predict
from features import FEATURE_NAMES
from train import DEFAULT_PARAMS, MODEL_OUT, N_FOLDS, OWN_DATASET, WINDOWS_CACHE, make_model

# ---------------- Tunable constants ----------------
RES_BANDS = [(0, 240, "<=240p"), (240, 480, "241-480p"), (480, 10_000, ">480p")]
LEARNING_FRACTIONS = [0.25, 0.5, 0.75, 1.0]
SEED = 42
# ---------------------------------------------------


def oof_scores(win, feats, params, train_frac=1.0):
    """Out-of-fold window scores with GroupKFold by video (optionally on a fraction of train videos)."""
    X, y, g = win[feats], win["label"].to_numpy(), win["group_id"].to_numpy()
    oof = np.zeros(len(win))
    rng = np.random.default_rng(SEED)
    for tr, te in GroupKFold(n_splits=N_FOLDS).split(X, y, g):
        if train_frac < 1.0:
            keep = rng.choice(np.unique(g[tr]), int(train_frac * len(np.unique(g[tr]))), replace=False)
            tr = tr[np.isin(g[tr], keep)]
        oof[te] = make_model(params).fit(X.iloc[tr], y[tr]).predict_proba(X.iloc[te])[:, 1]
    return oof


def clip_auc(win, prob):
    s = win.assign(p=prob).groupby("path").agg(label=("label", "first"), p=("p", "max"))
    return roc_auc_score(s["label"], s["p"])


def main():
    warnings.filterwarnings("ignore")
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", default="live_features.csv")
    args = ap.parse_args()

    params = joblib.load(MODEL_OUT).get("params", DEFAULT_PARAMS)  # our own model file
    win = pd.read_csv(WINDOWS_CACHE)
    win = win[win["dataset"] != OWN_DATASET].reset_index(drop=True)  # RLVS only, comparable numbers
    heights = {p: cv2.VideoCapture(p).get(cv2.CAP_PROP_FRAME_HEIGHT) for p in win["path"].unique()}
    win["frame_h"] = win["path"].map(heights)
    y = win["label"].to_numpy()
    print(f"{win['path'].nunique()} RLVS clips, {len(win)} windows, LightGBM {params}\n")

    # 1. Overall and per-resolution performance
    oof = oof_scores(win, FEATURE_NAMES, params)
    print("== 1. Cross-validated performance")
    print(f"window AUC {roc_auc_score(y, oof):.3f} | clip AUC {clip_auc(win, oof):.3f}")
    for lo, hi, name in RES_BANDS:
        m = ((win["frame_h"] > lo) & (win["frame_h"] <= hi)).to_numpy()
        n_clips = win[m].groupby("label")["path"].nunique().to_dict()
        if len(n_clips) == 2 and min(n_clips.values()) >= 10:
            print(f"   {name:9} clips {n_clips}: clip AUC {clip_auc(win[m], oof[m]):.3f}")
        else:
            print(f"   {name:9} clips {n_clips}: too few of one class to score")

    # 2. Single features
    print("\n== 2. Single-feature strength (window AUC on non-missing rows) and missing rate")
    rows = []
    for f in FEATURE_NAMES:
        ok = win[f].notna()
        auc = roc_auc_score(y[ok], win.loc[ok, f]) if ok.sum() > 50 else np.nan
        rows.append({"feature": f, "AUC": round(max(auc, 1 - auc), 3),
                     "direction": "higher=fight" if auc >= 0.5 else "lower=fight",
                     "missing_calm": f"{win.loc[y == 0, f].isna().mean():.0%}",
                     "missing_fight": f"{win.loc[y == 1, f].isna().mean():.0%}"})
    print(pd.DataFrame(rows).to_string(index=False))
    miss = win[FEATURE_NAMES].isna().any(axis=1).astype(int)
    print(f"   'any feature missing' alone predicts CALM with window AUC {roc_auc_score(1 - y, miss):.3f}")
    print(f"   frame height alone predicts the label with window AUC {roc_auc_score(y, win['frame_h']):.3f}")

    # 3. Ablations
    print("\n== 3. Ablations (clip AUC)")
    short, long_ = FEATURE_NAMES[:5], FEATURE_NAMES[5:]
    for name, feats in [("1 s features only", short), ("2 s features only", long_),
                        ("without pair_motion_energy", [f for f in FEATURE_NAMES if f != "pair_motion_energy"]),
                        ("wrist speed + accel only", ["max_wrist_speed", "max_wrist_accel"])]:
        print(f"   {name:28} {clip_auc(win, oof_scores(win, feats, params)):.3f}")
    rules = np.array([predict._rules(r) for r in win[FEATURE_NAMES].to_dict("records")])
    print(f"   {'rules mode (predict.py)':28} {clip_auc(win, rules):.3f}")

    # 4. Learning curve
    print("\n== 4. Learning curve (share of training videos per fold -> clip AUC)")
    for frac in LEARNING_FRACTIONS:
        n = int(frac * win["path"].nunique() * (N_FOLDS - 1) / N_FOLDS)
        print(f"   {frac:4.0%} ({n} train clips): {clip_auc(win, oof_scores(win, FEATURE_NAMES, params, frac)):.3f}")

    # 5. Live session vs training
    try:
        live = pd.read_csv(args.live)
    except FileNotFoundError:
        return
    if not set(FEATURE_NAMES) <= set(live.columns):
        print(f"\n== 5. {args.live} was recorded with older features; record a new session to compare.")
        return
    print(f"\n== 5. Live session ({args.live}, {len(live)} windows) vs training windows: medians")
    print(pd.DataFrame({"train_calm": win.loc[y == 0, FEATURE_NAMES].median(),
                        "train_fight": win.loc[y == 1, FEATURE_NAMES].median(),
                        "live_all": live[FEATURE_NAMES].median()}).round(2).to_string())
    if "label" in live:
        print(live.groupby("label")["raw_score"].describe()[["count", "mean", "50%", "max"]].round(2).to_string())


if __name__ == "__main__":
    main()
