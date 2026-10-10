"""
analyze_features.py - Step 2 of TRAINING_PLAN.md: are the new body-part features worth keeping?
Uses the TRAINING PART only (hold-out clips in holdout_groups.csv are never loaded).

Reports:
  1. single-feature window AUC and missing rate for every new feature
  2. ablation (GroupKFold out-of-fold): old 10 features vs old + all new
  3. drop-one: clip AUC change when each new feature is removed from old + all new
  4. the kept set: old + new features that pass KEEP rules, scored the same way

Usage:  python analyze_features.py
"""
import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

import train as T
from features import FEATURE_NAMES, OLD_FEATURES

# ---------------- Tunable constants ----------------
HOLDOUT_CSV = Path("holdout_groups.csv")
OUT_JSON = Path("feature_analysis.json")
# Same LightGBM settings as the v3 model, so only the feature set changes between rows.
PARAMS = dict(num_leaves=31, learning_rate=0.02, n_estimators=800, min_child_samples=20)
# A new feature is dropped if it is weak on its own AND removing it doesn't lower the clip AUC.
WEAK_AUC = 0.55          # |single-feature window AUC - 0.5| below this - 0.5 counts as weak
DROP_IF_DELTA_AT_LEAST = 0.0   # clip AUC change when removed; >= this means it isn't helping
# ---------------------------------------------------

NEW_FEATURES = [f for f in FEATURE_NAMES if f not in OLD_FEATURES]


def score(win, feats, weights):
    """Out-of-fold clip AUC overall + per dataset, and live-logic false alarms."""
    clips = T.clip_table(win, T.oof_scores(win, feats, PARAMS, weights))
    hugs = clips[(clips["dataset"] == "AIRTLab") & (clips["label"] == 0)]
    return {"auc": T.auc(clips), **{f"auc_{d}": T.auc(c) for d, c in clips.groupby("dataset")},
            "fights_FIGHT%": 100 * clips.loc[clips["label"] == 1, "live_fight"].mean(),
            "normal_FIGHT%": 100 * clips.loc[clips["label"] == 0, "live_fight"].mean(),
            "hugs_FIGHT%": 100 * hugs["live_fight"].mean(),
            "weapon_FIGHT%": 100 * clips.loc[clips["kind"] == "weapon", "live_fight"].mean()}


def main():
    warnings.filterwarnings("ignore", category=UserWarning)
    videos = pd.read_csv(T.VIDEOS_CSV)
    hold = set(pd.read_csv(HOLDOUT_CSV)["path"])
    videos = videos[~videos["path"].isin(hold)].reset_index(drop=True)
    print(f"Training part: {len(videos)} clips (hold-out of {len(hold)} clips never loaded)")
    win = T.load_windows(videos)
    weights = win["dataset"].map(T.DATASET_WEIGHT).fillna(1.0).to_numpy()
    print(f"{len(win)} windows\n")

    # ---- 1. Single features ----
    rows = []
    for f in NEW_FEATURES:
        ok = win[f].notna()
        a = roc_auc_score(win.loc[ok, "label"], win.loc[ok, f]) if win.loc[ok, "label"].nunique() == 2 else np.nan
        rows.append({"feature": f, "window AUC": a, "strength": abs(a - 0.5) + 0.5,
                     "missing %": 100 * (~ok).mean(),
                     "missing % calm": 100 * win.loc[win["label"] == 0, f].isna().mean(),
                     "missing % fight": 100 * win.loc[win["label"] == 1, f].isna().mean()})
    single = pd.DataFrame(rows).set_index("feature")
    print("=== 1. New features alone (window AUC; strength = distance from 0.5, either direction) ===")
    print(single.round(3).sort_values("strength", ascending=False).to_string())

    # ---- 2. Ablation ----
    print("\n=== 2. Ablation (5-fold GroupKFold, out-of-fold, training part) ===")
    abl = {"old 10": score(win, OLD_FEATURES, weights),
           f"old + all {len(NEW_FEATURES)} new": score(win, FEATURE_NAMES, weights)}
    print(pd.DataFrame(abl).T.round(3).to_string())

    # ---- 3. Drop-one ----
    base = abl[f"old + all {len(NEW_FEATURES)} new"]["auc"]
    delta = {}
    for f in NEW_FEATURES:
        delta[f] = score(win, [x for x in FEATURE_NAMES if x != f], weights)["auc"] - base
        print(f"  without {f:20s} clip AUC {base + delta[f]:.4f} ({delta[f]:+.4f})")
    single["AUC change if removed"] = pd.Series(delta)

    # ---- 4. Keep rule ----
    single["drop"] = (single["strength"] < WEAK_AUC) & (single["AUC change if removed"] >= DROP_IF_DELTA_AT_LEAST)
    kept = [f for f in NEW_FEATURES if not single.loc[f, "drop"]]
    print(f"\nDropped (weak alone AND removing it doesn't hurt): {[f for f in NEW_FEATURES if f not in kept]}")
    print(f"Kept new features: {kept}")
    abl[f"old + {len(kept)} kept new"] = score(win, OLD_FEATURES + kept, weights)
    print("\n=== Final comparison ===")
    print(pd.DataFrame(abl).T.round(3).to_string())

    OUT_JSON.write_text(json.dumps({"single": single.reset_index().to_dict("records"), "ablation": abl,
                                    "kept_new": kept, "params": PARAMS}, indent=2, default=float))
    print(f"\nSaved {OUT_JSON}")


if __name__ == "__main__":
    main()
