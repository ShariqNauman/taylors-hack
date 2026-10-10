"""
train_halfbody.py - Half-body round (v5): LightGBM side, ensemble threshold and evaluation.

Training data (training part only): every clip as full body, waist-up and chest-up, plus "single" and
"close" copies (one person alone / close to the camera) of NON-violent clips as own-room negatives.
Copies keep their clip's group, so folds and the hold-out never split a clip from its copies.
Features are clipped to the 1st-99th percentile of the training data (stored with the model, used live).
Single-person rule: a window with < 2 tracked people can't be FIGHT (train.SINGLE_PERSON_RULE).
Duplicate detections are merged in features.resample_window.

Steps (--step):
  oof       LightGBM out-of-fold on the saved folds -> oof_lgbm_v5.csv
  report    ensemble (with oof_seq.csv from the server) threshold at 9% normal false alarms on full-body
            training clips; per-variant results; single-person cost -> halfbody_cv.json
  holdout   second look at the hold-out: v5 vs v4 on full / waist-up / chest-up / single / close
            (v4 scores from v4code/score_v4.py) -> halfbody_holdout.json
  final     LightGBM on all clips + variants -> violence_model.joblib (v5)

Usage:  python train_halfbody.py --step oof|report|holdout|final
"""
import argparse
import json
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier

import train as T
from features import FEATURE_NAMES
from tune_lgbm import LGBM_KEYS, load_folds, sample_weights

# ---------------- Tunable constants ----------------
HOLDOUT_CSV = Path("holdout_groups.csv")
BEST_LGBM = Path("best_lgbm.json")
OOF_LGBM = Path("oof_lgbm_v5.csv")
OOF_SEQ = Path("oof_seq.csv")              # from seq_train.py (v5) on the server
HOLDOUT_SEQ = Path("holdout_seq.csv")      # from seq_final.py (v5) on the server
V4_HOLDOUT = Path("holdout_v4_scores.csv") # from v4code/score_v4.py
CV_JSON, HOLD_JSON = Path("halfbody_cv.json"), Path("halfbody_holdout.json")
V4_FIGHT_AT = 0.658                        # v4 ensemble threshold (as shipped)
CLIP_PCT = (1, 99)
SEED = 42
VARIANTS = ["full", "waist-up", "chest-up", "single", "close"]
# ---------------------------------------------------


def load():
    videos = pd.read_csv(T.VIDEOS_CSV)
    hold = set(pd.read_csv(HOLDOUT_CSV)["path"])
    win = T.load_windows(T.with_crops(videos, synthetic=True))
    win["end_s"] = win["end_s"].round(2)
    win["base"] = win["path"].str.split("#").str[0]
    win["is_hold"] = win["base"].isin(hold)
    # one person alone is never a fight: synthetic copies of violent clips are test-only
    win["trainable"] = ~(win["crop"].isin(["single", "close"]) & (win["label"] == 1))
    return win


def clip_ranges(win):
    q = win[FEATURE_NAMES].quantile([CLIP_PCT[0] / 100, CLIP_PCT[1] / 100])
    return {f: [float(q.iloc[0][f]), float(q.iloc[1][f])] for f in FEATURE_NAMES}


def clip(X, ranges):
    return X.clip(lower=pd.Series({f: r[0] for f, r in ranges.items()}),
                  upper=pd.Series({f: r[1] for f, r in ranges.items()}), axis=1)


def fit(win, c, ranges):
    m = LGBMClassifier(**{k: c[k] for k in LGBM_KEYS}, subsample_freq=1, random_state=SEED, verbose=-1,
                       deterministic=True, force_row_wise=True)
    return m.fit(clip(win[FEATURE_NAMES], ranges), win["label"], sample_weight=sample_weights(win, c))


def rates(clips, fight_at):
    hit = clips["sustained"] >= fight_at
    pct = lambda m: round(100 * hit[m].mean(), 1) if m.any() else None
    lab1, lab0 = clips["label"] == 1, clips["label"] == 0
    return {"clips": len(clips), "auc": round(T.auc(clips), 4) if clips["label"].nunique() == 2 else None,
            "fights%": pct(lab1), "normal%": pct(clips["kind"] == "normal"),
            "hugs%": pct((clips["dataset"] == "AIRTLab") & lab0), "weapon%": pct(clips["kind"] == "weapon"),
            "any FIGHT%": pct(clips["label"] >= 0)}


def per_variant(win, p, fight_at):
    out = {}
    for v in VARIANTS:
        m = (win["crop"] == v).to_numpy()
        if m.any():
            out[v] = rates(T.sustained_scores(win[m], p[m]), fight_at)
    return out


def step_oof(win):
    tr = win[~win["is_hold"] & win["trainable"]].reset_index(drop=True)
    best = json.loads(BEST_LGBM.read_text())["settings"]
    ranges = clip_ranges(tr)
    fold = load_folds(tr)
    p = np.zeros(len(tr))
    for k in range(int(fold.max()) + 1):
        p[fold == k] = fit(tr[fold != k], best, ranges).predict_proba(
            clip(tr.loc[fold == k, FEATURE_NAMES], ranges))[:, 1]
    tr[["path", "end_s", "label", "dataset", "kind", "crop", "n_people", "group_id"]].assign(p=p, fold=fold).to_csv(
        OOF_LGBM, index=False)
    print(f"{len(tr)} training windows ({tr['path'].nunique()} clips + copies) -> {OOF_LGBM}")


def step_report(win):
    lg = pd.read_csv(OOF_LGBM)
    sq = pd.read_csv(OOF_SEQ)[["path", "end_s", "p"]].assign(end_s=lambda d: d["end_s"].round(2))
    w = lg.merge(sq, on=["path", "end_s"], suffixes=("_lgbm", "_seq"))
    print(f"{len(w)} of {len(lg)} windows have both scores")
    res, th = {}, {}
    for name, p in (("LightGBM", w["p_lgbm"]), ("CNN", w["p_seq"]), ("ensemble", (w["p_lgbm"] + w["p_seq"]) / 2)):
        p = p.to_numpy()
        full = (w["crop"] == "full").to_numpy()
        th[name] = T.at_matched_fa(T.sustained_scores(w[full], p[full]))["FIGHT_AT"]
        res[name] = per_variant(w, p, th[name])
    print("Thresholds (9% normal false alarms, full-body training clips):", th)
    for name, r in res.items():
        print(f"\n=== {name} (out-of-fold, training part) ===")
        print(pd.DataFrame(r).T.to_string())
    # single-person cost: how often fight clips have only 1 tracked person
    fw = win[~win["is_hold"] & (win["crop"] == "full") & (win["label"] == 1)]
    one = fw["n_people"] < 2
    clip_all_one = fw.assign(one=one).groupby("path")["one"].all()
    cost = {"fight windows with < 2 people %": round(100 * one.mean(), 1),
            "fight clips with < 2 people in every window %": round(100 * clip_all_one.mean(), 1)}
    print("\nSingle-person rule cost (training part, full body):", cost)
    CV_JSON.write_text(json.dumps({"thresholds": th, "results": res, "single_person_cost": cost}, indent=2,
                                  default=float))


def step_holdout(win):
    hold = win[win["is_hold"]].reset_index(drop=True)
    tr = win[~win["is_hold"] & win["trainable"]].reset_index(drop=True)
    best = json.loads(BEST_LGBM.read_text())["settings"]
    ranges = clip_ranges(tr)
    p_l = fit(tr, best, ranges).predict_proba(clip(hold[FEATURE_NAMES], ranges))[:, 1]
    sq = pd.read_csv(HOLDOUT_SEQ).assign(end_s=lambda d: d["end_s"].round(2))
    p_s = hold[["path", "end_s"]].merge(sq, on=["path", "end_s"], how="left")["p"].to_numpy()
    assert not np.isnan(p_s).any(), "hold-out windows without CNN scores"
    th = json.loads(CV_JSON.read_text())["thresholds"]["ensemble"]
    v5 = per_variant(hold, (p_l + p_s) / 2, th)
    v4s = pd.read_csv(V4_HOLDOUT).assign(end_s=lambda d: d["end_s"].round(2))
    h4 = hold[["path", "end_s", "label", "dataset", "kind", "crop"]].merge(v4s, on=["path", "end_s"])
    T.SINGLE_PERSON_RULE = False            # v4 as it ran: no single-person rule
    v4 = per_variant(h4, h4["p"].to_numpy(), V4_FIGHT_AT)
    T.SINGLE_PERSON_RULE = True
    out = {"v4 (as shipped)": v4, "v5": v5, "v5_fight_at": th}
    for name in ("v4 (as shipped)", "v5"):
        print(f"\n=== HOLD-OUT (second look): {name} ===")
        print(pd.DataFrame(out[name]).T.to_string())
    HOLD_JSON.write_text(json.dumps(out, indent=2, default=float))


def step_proof(win):
    """proof.json + metrics_v2.json from the v5 hold-out numbers (second look at the hold-out)."""
    from finalize_model import POSE_MS, INPUT_MS, MODEL_MS, row
    hold = win[win["is_hold"]].reset_index(drop=True)
    tr = win[~win["is_hold"] & win["trainable"]].reset_index(drop=True)
    best = json.loads(BEST_LGBM.read_text())["settings"]
    ranges = clip_ranges(tr)
    p_l = fit(tr, best, ranges).predict_proba(clip(hold[FEATURE_NAMES], ranges))[:, 1]
    sq = pd.read_csv(HOLDOUT_SEQ).assign(end_s=lambda d: d["end_s"].round(2))
    p = (p_l + hold[["path", "end_s"]].merge(sq, on=["path", "end_s"], how="left")["p"].to_numpy()) / 2
    fa = json.loads(CV_JSON.read_text())["thresholds"]["ensemble"]
    full = (hold["crop"] == "full").to_numpy()
    clips = T.sustained_scores(hold[full], p[full])
    phone, cctv = row(clips[clips["dataset"].isin(["RLVS", "AIRTLab"])], fa), row(clips[clips["dataset"].isin(["SCF", "SCVD"])], fa)
    hugs = clips[(clips["dataset"] == "AIRTLab") & (clips["label"] == 0)]
    hres = json.loads(HOLD_JSON.read_text())
    v5 = hres["v5"]
    proof = json.loads(Path("proof.json").read_text())
    proof.update({
        "n_clips": int(hold.loc[full, "path"].nunique()),
        "clip_auc": phone["auc"], "clip_precision": phone["precision"], "clip_recall": phone["recall"],
        "cctv_domain": {k: cctv[k] for k in ("datasets", "auc", "precision", "recall")},
        "airtlab_fp_rate": round(float((hugs["sustained"] >= fa).mean()), 3),
        "latency_ms": POSE_MS + INPUT_MS + MODEL_MS + 3,   # + duplicate-person check (~3 ms)
        "robustness": {v: {k: v5[v][k] for k in ("auc", "fights%", "normal%", "hugs%", "any FIGHT%") if v5[v].get(k) is not None}
                       for v in VARIANTS},
        "holdout_use": "second look: this hold-out was also used once for the v4 model",
    })
    proof["model_card"]["classifier"] = ("ensemble: average of LightGBM (24 features, clipped to the training "
                                         "1st-99th percentile) and a 51k-parameter 1D-CNN over the active pair's "
                                         "keypoint sequence; trained on full, waist-up and chest-up copies of every "
                                         "clip plus one-person / close-to-camera negatives")
    proof["model_card"]["threshold"] = (f"alarm when the smoothed score (alpha {T.LIVE['SMOOTH_ALPHA']}) stays >= {fa} "
                                        f"for {T.LIVE['MIN_DURATION']} s with at least 2 people tracked; FIGHT_AT fixed "
                                        "on the training part at 9% normal-clip false alarms")
    proof["model_card"]["failure_modes"][0] = (f"hugs and close contact: {int((hugs['sustained'] >= fa).sum())} of "
                                               f"{len(hugs)} hold-out hug/clap clips raised an alarm")
    proof["model_card"]["failure_modes"].append("a fight where only one person is tracked can't raise FIGHT "
                                                "(1.7% of fight clips in training)")
    proof["disclosure"] = proof["disclosure"].replace(
        "Official numbers are from a hold-out set", "Official numbers are from a second look at a hold-out set")
    Path("proof.json").write_text(json.dumps(proof, indent=2, default=float))
    Path("metrics_v2.json").write_text(json.dumps({
        "official": "hold-out, second look (v5)", "holdout_v5_vs_v4": hres, "holdout_rows": {"phone": phone, "cctv": cctv},
        "cross_validation_training_part": json.loads(CV_JSON.read_text()), "lgbm_settings": best,
        "fight_at": json.loads(CV_JSON.read_text())["thresholds"]}, indent=2, default=float))
    print("proof.json:", {k: proof[k] for k in ("clip_auc", "clip_precision", "clip_recall", "cctv_domain", "airtlab_fp_rate")})


def step_final(win):
    allw = win[win["trainable"]].reset_index(drop=True)
    best = json.loads(BEST_LGBM.read_text())["settings"]
    ranges = clip_ranges(allw[~allw["is_hold"]])   # same ranges as evaluated (training part)
    th = json.loads(CV_JSON.read_text())["thresholds"]
    model = fit(allw, best, ranges)
    joblib.dump({"model": model, "features": FEATURE_NAMES, "clip": ranges,
                 "name": "lightgbm v5 (half-body, trial 94 settings, all clips + copies)", "params": best,
                 "fight_at": {"ensemble": th["ensemble"], "lgbm": th["LightGBM"]}}, T.MODEL_OUT)
    print(f"Saved {T.MODEL_OUT}: {len(allw)} windows; thresholds {th}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", required=True, choices=["oof", "report", "holdout", "final", "proof"])
    args = ap.parse_args()
    warnings.filterwarnings("ignore", category=UserWarning)
    {"oof": step_oof, "report": step_report, "holdout": step_holdout, "final": step_final,
     "proof": step_proof}[args.step](load())


if __name__ == "__main__":
    main()
