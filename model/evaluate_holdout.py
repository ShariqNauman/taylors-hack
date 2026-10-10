"""
evaluate_holdout.py - Step 5 of TRAINING_PLAN.md: score the candidates ONCE on the hold-out set.

Models (all trained on the 85% training part unless noted):
  ensemble        LightGBM trial 94 + 1D-CNN (holdout_seq.csv from seq_final.py), averaged
  LightGBM alone  trial 94 settings and weights (best_lgbm.json)
  v3 recipe       old 10 features, v3 settings and weights, retrained on the training part (fair baseline)
  backup_v3 file  the shipped v3 model as-is. It was trained on ALL clips, hold-out included, so its
                  hold-out numbers are flattering; shown for completeness only.
Thresholds: each model's FIGHT_AT is fixed on the TRAINING PART (out-of-fold, matched to 9% normal false
alarms) and then applied to the hold-out unchanged. backup_v3 uses the v3 recipe's threshold.
Reports clip AUC overall and per dataset, precision / recall with the live logic, and % of fights,
normal clips, AIRTLab hugs/claps and weapon clips reaching FIGHT.

Usage:  python evaluate_holdout.py        (run once; writes holdout_results.json)
"""
import json
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier

import train as T
from features import FEATURE_NAMES, OLD_FEATURES
from tune_lgbm import LGBM_KEYS, REFERENCE, load_folds, sample_weights

# ---------------- Tunable constants ----------------
HOLDOUT_CSV = Path("holdout_groups.csv")
BEST_LGBM = Path("best_lgbm.json")
OOF_LGBM, OOF_SEQ = Path("oof_lgbm.csv"), Path("oof_seq.csv")
HOLDOUT_SEQ = Path("holdout_seq.csv")
BACKUP_V3 = Path("backup_v3/violence_model.joblib")
OUT_JSON = Path("holdout_results.json")
CLIPS_OUT = Path("holdout_clips.csv")
V3_SETTINGS = dict(REFERENCE)             # v3 LightGBM settings, weights AIRTLab 3 / CCTV 2, no hug multiplier
SEED = 42
# ---------------------------------------------------


def fit(win, feats, c):
    m = LGBMClassifier(**{k: c[k] for k in LGBM_KEYS}, subsample_freq=1, random_state=SEED, verbose=-1,
                       deterministic=True, force_row_wise=True)  # bit-for-bit reproducible
    return m.fit(win[feats], win["label"], sample_weight=sample_weights(win, c))


def oof(win, fold, feats, c):
    p = np.zeros(len(win))
    for k in range(int(fold.max()) + 1):
        tr, te = fold != k, fold == k
        p[te] = fit(win[tr], feats, c).predict_proba(win.loc[te, feats])[:, 1]
    return p


def holdout_report(win, p, fight_at):
    clips = T.sustained_scores(win, p)
    hit = clips["sustained"] >= fight_at
    tp, fp = int((hit & (clips["label"] == 1)).sum()), int((hit & (clips["label"] == 0)).sum())
    fn = int((~hit & (clips["label"] == 1)).sum())
    pct = lambda m: round(100 * hit[m].mean(), 1)
    return {"clip_auc": round(T.auc(clips), 4),
            **{f"auc_{d}": round(T.auc(c), 4) for d, c in clips.groupby("dataset")},
            "FIGHT_AT": round(fight_at, 4), "precision": round(tp / max(tp + fp, 1), 3),
            "recall": round(tp / max(tp + fn, 1), 3),
            "fights%": pct(clips["label"] == 1), "normal%": pct(clips["kind"] == "normal"),
            "hugs%": pct((clips["dataset"] == "AIRTLab") & (clips["label"] == 0)),
            "weapon%": pct(clips["kind"] == "weapon")}


def main():
    warnings.filterwarnings("ignore", category=UserWarning)
    videos = pd.read_csv(T.VIDEOS_CSV)
    is_hold = videos["path"].isin(set(pd.read_csv(HOLDOUT_CSV)["path"]))
    allwin = T.load_windows(videos)
    allwin["end_s"] = allwin["end_s"].round(2)
    hold = allwin[allwin["path"].isin(set(videos.loc[is_hold, "path"]))].reset_index(drop=True)
    trainw = allwin[allwin["path"].isin(set(videos.loc[~is_hold, "path"]))].reset_index(drop=True)
    print(f"Training part {trainw['path'].nunique()} clips, hold-out {hold['path'].nunique()} clips "
          f"({len(hold)} windows)")

    best = json.loads(BEST_LGBM.read_text())["settings"]

    # ---- Thresholds from the training part (out-of-fold, matched 9% normal FA) ----
    lg_oof = pd.read_csv(OOF_LGBM).assign(end_s=lambda d: d["end_s"].round(2))
    sq_oof = pd.read_csv(OOF_SEQ)[["path", "end_s", "p"]].assign(end_s=lambda d: d["end_s"].round(2))
    both = lg_oof.merge(sq_oof, on=["path", "end_s"], suffixes=("_lgbm", "_seq"))
    th = {"LightGBM alone": T.at_matched_fa(T.sustained_scores(both, both["p_lgbm"].to_numpy()))["FIGHT_AT"],
          "ensemble": T.at_matched_fa(T.sustained_scores(both, ((both["p_lgbm"] + both["p_seq"]) / 2).to_numpy()))["FIGHT_AT"]}
    fold = load_folds(trainw)
    th["v3 recipe"] = T.at_matched_fa(T.sustained_scores(trainw, oof(trainw, fold, OLD_FEATURES, V3_SETTINGS)))["FIGHT_AT"]
    th["backup_v3 file (in-sample!)"] = th["v3 recipe"]
    print("Thresholds fixed on the training part:", th)

    # ---- Hold-out scores (the one evaluation) ----
    p_lgbm = fit(trainw, FEATURE_NAMES, best).predict_proba(hold[FEATURE_NAMES])[:, 1]
    seq = pd.read_csv(HOLDOUT_SEQ).assign(end_s=lambda d: d["end_s"].round(2))
    p_seq = hold[["path", "end_s"]].merge(seq, on=["path", "end_s"], how="left")["p"].to_numpy()
    assert not np.isnan(p_seq).any(), "hold-out windows missing sequence scores"
    p_v3 = fit(trainw, OLD_FEATURES, V3_SETTINGS).predict_proba(hold[OLD_FEATURES])[:, 1]
    bundle = joblib.load(BACKUP_V3)  # our own model file
    p_backup = bundle["model"].predict_proba(hold[bundle["features"]].astype(float))[:, 1]

    scores = {"ensemble": (p_lgbm + p_seq) / 2, "LightGBM alone": p_lgbm, "v3 recipe": p_v3,
              "backup_v3 file (in-sample!)": p_backup}
    res = {k: holdout_report(hold, p, th[k]) for k, p in scores.items()}
    clips = pd.concat([T.sustained_scores(hold, p).assign(model=k, FIGHT_AT=th[k]) for k, p in scores.items()])
    clips.to_csv(CLIPS_OUT, index=False)  # per-clip hold-out scores, for proof.json subsets
    print("\n=== HOLD-OUT results (evaluated once) ===")
    print(pd.DataFrame(res).T.to_string())
    OUT_JSON.write_text(json.dumps({"results": res, "thresholds": th, "n_clips": int(hold["path"].nunique()),
                                    "lgbm_settings": best}, indent=2, default=float))
    print(f"\nSaved {OUT_JSON}")


if __name__ == "__main__":
    main()
