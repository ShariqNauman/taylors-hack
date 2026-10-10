"""
tune_lgbm.py - Step 3 of TRAINING_PLAN.md: randomized LightGBM search on the TRAINING PART only.

Searches LightGBM settings and sample weights:
  dataset weights  AIRTLab 2-4x, CCTV (SCF, SCVD) 1-3x, RLVS 1x
  hug multiplier   AIRTLab non-violent clips (hugs/claps) get AIRTLab weight x 3-8 (hard negatives)

Every candidate is scored out-of-fold on the same saved folds (folds.csv, GroupKFold by group_id):
  clip ROC-AUC, and at its own matched threshold (FIGHT_AT where TARGET_NORMAL_FA of normal clips
  reach FIGHT with the live logic): fights caught, AIRTLab hugs/claps reaching FIGHT, weapon caught.
Pick rule (hug guardrail): reject candidates whose hug rate > HUG_LIMIT; pick the highest clip AUC.
If none pass, print the 5 lowest-hug candidates and pick nothing.

Writes tune_results.csv (all candidates), best_lgbm.json (pick) and oof_lgbm.csv (its out-of-fold
window scores, for the step 4 ensemble).

Usage:  python tune_lgbm.py              # N_TRIALS settings
        python tune_lgbm.py --trials 5   # quick test
"""
import argparse
import json
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.model_selection import GroupKFold

import train as T
from features import FEATURE_NAMES

# ---------------- Tunable constants ----------------
HOLDOUT_CSV = Path("holdout_groups.csv")
FOLDS_CSV = Path("folds.csv")
RESULTS_CSV = Path("tune_results.csv")
BEST_JSON = Path("best_lgbm.json")
OOF_CSV = Path("oof_lgbm.csv")
N_TRIALS = 100
N_FOLDS = 5
SEED = 42
HUG_LIMIT = 18.6         # % of AIRTLab hugs/claps reaching FIGHT at matched FA (old-10 model's rate)
GRID = {
    "num_leaves": [7, 15, 31, 63, 127],
    "learning_rate": [0.01, 0.02, 0.03, 0.05, 0.08],
    "n_estimators": [200, 400, 800, 1200],
    "min_child_samples": [10, 20, 50, 100, 200],
    "subsample": [0.6, 0.8, 1.0],
    "colsample_bytree": [0.5, 0.7, 0.9, 1.0],
    "reg_lambda": [0.0, 0.1, 1.0, 5.0, 10.0],
    "w_airtlab": [2.0, 3.0, 4.0],
    "w_cctv": [1.0, 1.5, 2.0, 2.5, 3.0],
    "hug_mult": [3.0, 4.0, 5.0, 6.0, 8.0],
}
LGBM_KEYS = ["num_leaves", "learning_rate", "n_estimators", "min_child_samples", "subsample",
             "colsample_bytree", "reg_lambda"]
# The v3 settings, scored the same way as a reference row (not eligible: hug multiplier 1 is outside the range).
REFERENCE = dict(num_leaves=31, learning_rate=0.02, n_estimators=800, min_child_samples=20, subsample=0.8,
                 colsample_bytree=0.8, reg_lambda=0.0, w_airtlab=3.0, w_cctv=2.0, hug_mult=1.0)
# ---------------------------------------------------


def make_model(c):
    return LGBMClassifier(**{k: c[k] for k in LGBM_KEYS}, subsample_freq=1, random_state=SEED, verbose=-1)


def sample_weights(win, c):
    w = win["dataset"].map({"AIRTLab": c["w_airtlab"], "SCF": c["w_cctv"], "SCVD": c["w_cctv"],
                            "RLVS": 1.0}).fillna(1.0).to_numpy()
    hugs = ((win["dataset"] == "AIRTLab") & (win["label"] == 0)).to_numpy()
    return np.where(hugs, w * c["hug_mult"], w)


def load_folds(win):
    """Fold per group_id, saved once so every step uses the same folds."""
    if FOLDS_CSV.exists():
        folds = pd.read_csv(FOLDS_CSV)
    else:
        groups = win.groupby("group_id")["path"].first().reset_index()
        folds = groups[["group_id"]].assign(fold=-1)
        for k, (_, te) in enumerate(GroupKFold(n_splits=N_FOLDS).split(groups, groups=groups["group_id"])):
            folds.loc[te, "fold"] = k
        folds.to_csv(FOLDS_CSV, index=False)
    return win["group_id"].map(folds.set_index("group_id")["fold"]).to_numpy()


def oof(win, fold, c):
    X, y, w = win[FEATURE_NAMES], win["label"].to_numpy(), sample_weights(win, c)
    p = np.zeros(len(win))
    for k in range(N_FOLDS):
        tr, te = fold != k, fold == k
        p[te] = make_model(c).fit(X[tr], y[tr], sample_weight=w[tr]).predict_proba(X[te])[:, 1]
    return p


def evaluate(win, p):
    clips = T.sustained_scores(win, p)
    return {"clip_auc": round(T.auc(clips), 4), **T.at_matched_fa(clips)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=int, default=N_TRIALS)
    args = ap.parse_args()
    warnings.filterwarnings("ignore", category=UserWarning)

    videos = pd.read_csv(T.VIDEOS_CSV)
    videos = videos[~videos["path"].isin(set(pd.read_csv(HOLDOUT_CSV)["path"]))].reset_index(drop=True)
    win = T.load_windows(videos)
    fold = load_folds(win)
    assert (fold >= 0).all() and win.groupby("group_id").apply(lambda g: fold[g.index].min() == fold[g.index].max()).all()
    print(f"Training part: {win['path'].nunique()} clips, {len(win)} windows, folds in {FOLDS_CSV}")

    rng = np.random.default_rng(SEED)
    trials, seen = [], set()
    while len(trials) < args.trials:
        c = {k: v[int(rng.integers(len(v)))] for k, v in GRID.items()}
        key = tuple(c.values())
        if key not in seen:
            seen.add(key)
            trials.append(c)

    rows, start = [], time.time()
    for i, c in enumerate([REFERENCE] + trials):
        r = {"trial": "reference (v3 settings)" if i == 0 else i, **c, **evaluate(win, oof(win, fold, c))}
        rows.append(r)
        print(f"[{i:3d}/{len(trials)}] AUC {r['clip_auc']:.4f}  fights {r['fights%']:5.1f}%  "
              f"hugs {r['hugs%']:5.1f}%  weapon {r['weapon%']:5.1f}%  ({time.time() - start:.0f} s)", flush=True)
        pd.DataFrame(rows).to_csv(RESULTS_CSV, index=False)  # saved after every trial

    res = pd.DataFrame(rows)
    cand = res[res["trial"] != "reference (v3 settings)"]
    show = ["trial", "clip_auc", "FIGHT_AT", "fights%", "hugs%", "weapon%", *GRID]
    print("\nReference (v3 settings, new features):")
    print(res[res["trial"] == "reference (v3 settings)"][show].to_string(index=False))
    passed = cand[cand["hugs%"] <= HUG_LIMIT].sort_values("clip_auc", ascending=False)
    print(f"\n{len(passed)} of {len(cand)} candidates pass the hug guardrail (hugs <= {HUG_LIMIT}%)")
    if passed.empty:
        print("No candidate passes. 5 lowest hug rates (choose the trade-off):")
        print(cand.sort_values(["hugs%", "clip_auc"], ascending=[True, False]).head(5)[show].to_string(index=False))
        return
    print(passed.head(10)[show].to_string(index=False))
    best = passed.iloc[0].to_dict()
    best_c = {k: best[k] for k in GRID}
    best_c = {k: (int(v) if k in ("num_leaves", "n_estimators", "min_child_samples") else float(v))
              for k, v in best_c.items()}
    p = oof(win, fold, best_c)
    win[["path", "end_s", "label", "dataset", "kind", "group_id"]].assign(p=p, fold=fold).to_csv(OOF_CSV, index=False)
    BEST_JSON.write_text(json.dumps({"settings": best_c, "scores": {k: best[k] for k in res.columns
                                                                     if k not in GRID and k != "trial"},
                                     "trial": int(best["trial"]), "hug_limit": HUG_LIMIT}, indent=2, default=float))
    print(f"\nPicked trial {int(best['trial'])}: {best_c}\nSaved {BEST_JSON}, {OOF_CSV}")


if __name__ == "__main__":
    main()
