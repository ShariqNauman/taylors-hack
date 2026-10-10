"""
train_v6.py - Step 5: retrain so the model detects violence, not fast movement. TRAINING PART only for
every choice; the hold-out is untouched.

Data: everything v5 trained on, plus KTH running / walking (label 0, KTH_WEIGHT) and our own camera
(OWN_WEIGHT; windows labelled from data/recorded_data/fight_times.csv: inside a fight = 1, else 0;
violence videos are left out until that file exists).
Hard negatives: non-violent windows in the top FAST_PCT body speed with 2+ people get HN weight x.

Steps (--step):
  weights   per-window weights / trainable flag / folds for both models -> weights_v6.csv, folds.csv
            (new groups added) ; upload these for the CNN
  lgbm      LightGBM candidates out-of-fold: v6, v6-no-speed, v6-hn3/4/5 -> oof_lgbm_v6.csv
  report    with oof_seq_v6.csv (CNN, server): every candidate alone and as an ensemble, at its own
            matched 9% normal threshold: fights, normal, hugs, weapon, fast slice, KTH, own non-violence;
            hug and speed guardrails; TWO_KEY with the impact cue -> v6_candidates.json

Usage:  python train_v6.py --step weights|lgbm|report
"""
import argparse
import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier

import train as T
import train_halfbody as H
from features import FEATURE_NAMES
from guards import Config, LevelLogic
from tune_lgbm import LGBM_KEYS, sample_weights

# ---------------- Tunable constants ----------------
FIGHT_TIMES = Path("data/recorded_data/fight_times.csv")
FAST_TIMES = Path("data/recorded_data/fast_times.csv")   # running segments in our non-violence videos
WEIGHTS_CSV = Path("weights_v6.csv")
FOLDS_CSV = Path("folds.csv")
OOF_LGBM, OOF_SEQ = Path("oof_lgbm_v6.csv"), Path("oof_seq_v6.csv")
OUT_JSON = Path("v6_candidates.json")
KTH_WEIGHT, OWN_WEIGHT = 2.0, 5.0
FAST_PCT, SPEED = 0.20, "energy_max"
HN_WEIGHTS = (3.0, 4.0, 5.0)
CNN_HN = 4.0              # the CNN is trained once, with this hard-negative weight
HUG_LIMIT = 18.6
SPEED_FEATURES = ["max_wrist_speed", "max_wrist_accel", "energy_max", "energy_min", "pair_motion_energy"]
SEED = 42
# ---------------------------------------------------


def labelled_windows():
    """All windows (variants included) with own-camera labels from fight_times.csv and the trainable flag."""
    w = H.load()
    w["own"] = w["dataset"] == "OwnRec"
    if FIGHT_TIMES.exists():
        ft = pd.read_csv(FIGHT_TIMES)
        name = w["base"].map(lambda p: Path(p).name)
        inside = np.zeros(len(w), bool)
        for r in ft.itertuples():
            inside |= ((name == r.file) & (w["end_s"] > r.fight_start_s) & (w["end_s"] - 1.0 <= r.fight_end_s)).to_numpy()
        w.loc[w["own"], "label"] = inside[w["own"].to_numpy()].astype(int)
    else:  # no fight seconds: our violence videos can't be labelled per window
        w.loc[w["own"] & (w["label"] == 1), "trainable"] = False
    w["own_fast"] = False   # running segments of our own non-violence videos (fast non-violent, label 0)
    if FAST_TIMES.exists():
        name = w["base"].map(lambda p: Path(p).name)
        for r in pd.read_csv(FAST_TIMES).itertuples():
            w.loc[(name == r.file) & (w["end_s"] > r.fast_start_s) & (w["end_s"] - 1.0 <= r.fast_end_s), "own_fast"] = True
    return w


def fast_negatives(w, cut):
    """Hard negatives: fast non-violent windows with 2+ people, plus the running segments of our own videos."""
    fast = (w["label"] == 0) & (w[SPEED] >= cut) & (w["n_people"] >= 2)
    return (fast | (w["own_fast"] & (w["label"] == 0)) if "own_fast" in w else fast).to_numpy()


def weights(w, hn, cut, best):
    base = sample_weights(w, best)                       # v5: AIRTLab / CCTV weights and hug multiplier
    base = np.where(w["dataset"] == "KTH", KTH_WEIGHT, base)
    base = np.where(w["own"], OWN_WEIGHT, base)
    return np.where(fast_negatives(w, cut), base * hn, base)


def fit(w, feats, wt, best):
    m = LGBMClassifier(**{k: best[k] for k in LGBM_KEYS}, subsample_freq=1, random_state=SEED, verbose=-1,
                       deterministic=True, force_row_wise=True)
    return m.fit(w[feats], w["label"], sample_weight=wt)


def training_part(w):
    return w[~w["is_hold"] & w["trainable"]].reset_index(drop=True)


def speed_cut(tr):
    nv = tr[(tr["crop"] == "full") & (tr["label"] == 0) & tr["dataset"].isin(["RLVS", "SCF", "SCVD", "AIRTLab"])]
    return float(nv[SPEED].quantile(1 - FAST_PCT))


def step_weights(w):
    best = json.loads(H.BEST_LGBM.read_text())["settings"]
    tr = training_part(w)
    cut = speed_cut(tr)
    folds = pd.read_csv(FOLDS_CSV)
    new = sorted(set(w["group_id"]) - set(folds["group_id"]))
    if new:
        folds = pd.concat([folds, pd.DataFrame({"group_id": new, "fold": [g % 5 for g in new]})])
        folds.to_csv(FOLDS_CSV, index=False)
    out = w[["path", "end_s", "label", "trainable", "is_hold"]].assign(
        weight=weights(w, CNN_HN, cut, best), fast_neg=fast_negatives(w, cut))
    out.to_csv(WEIGHTS_CSV, index=False)
    print(f"speed cut {SPEED} >= {cut:.2f}; {int(out['fast_neg'].sum())} hard-negative windows; "
          f"{len(new)} new groups added to {FOLDS_CSV}; trainable training-part windows {int((out.trainable & ~out.is_hold).sum())}")


def step_lgbm(w):
    best = json.loads(H.BEST_LGBM.read_text())["settings"]
    tr = training_part(w)
    cut = speed_cut(tr)
    fold = tr["group_id"].map(pd.read_csv(FOLDS_CSV).set_index("group_id")["fold"]).to_numpy()
    no_speed = [f for f in FEATURE_NAMES if f not in SPEED_FEATURES]
    cands = {"v6": (FEATURE_NAMES, 1.0), "v6-no-speed": (no_speed, 1.0),
             **{f"v6-hn{int(h)}": (FEATURE_NAMES, h) for h in HN_WEIGHTS}}
    out = tr[["path", "end_s", "label", "dataset", "kind", "crop", "group_id", "n_people", SPEED,
              "impact_with_reaction_count", "wrist_toward_speed", "contact_s", "n_people_1s", "pair_min_dist"]].copy()
    for name, (feats, hn) in cands.items():
        wt = weights(tr, hn, cut, best)
        p = np.zeros(len(tr))
        for k in range(5):
            p[fold == k] = fit(tr[fold != k], feats, wt[fold != k], best).predict_proba(tr.loc[fold == k, feats])[:, 1]
        out[f"p_{name}"] = p
        print(f"{name}: done", flush=True)
    out["fast_neg"] = fast_negatives(tr, cut)
    out.to_csv(OOF_LGBM, index=False)


def window_levels(w, p, cfg):
    lv = np.empty(len(w), object)
    for _, idx in w.groupby("path", sort=False).indices.items():
        logic = LevelLogic(cfg)
        for i in idx:
            lv[i] = logic.step(w["end_s"].iat[i], p[i], w.iloc[i].to_dict())[0]
    return lv


def evaluate(w, p, cfg_kw=None):
    """At the candidate's own matched 9% normal threshold (full-body clips): clip and window FIGHT rates."""
    full = (w["crop"] == "full").to_numpy()
    fa = T.at_matched_fa(T.sustained_scores(w[full], p[full]))["FIGHT_AT"]
    cfg = Config(alpha=T.LIVE["SMOOTH_ALPHA"], tense_at=min(T.LIVE["TENSE_AT"], fa - 0.01), fight_at=fa,
                 min_duration=T.LIVE["MIN_DURATION"], **(cfg_kw or {}))
    wf = w[full].reset_index(drop=True)
    lv = window_levels(wf, p[full], cfg)
    fight_w = lv == "FIGHT"
    clip = wf.assign(f=fight_w).groupby("path").agg(f=("f", "any"), label=("label", "first"),
                                                     dataset=("dataset", "first"), kind=("kind", "first"))
    pc = lambda m: round(100 * clip.loc[m, "f"].mean(), 1) if m.any() else None
    pw = lambda m: round(100 * fight_w[m].mean(), 1) if m.any() else None
    return {"FIGHT_AT": round(fa, 4), "clip_auc": round(T.auc(T.sustained_scores(wf, p[full])), 4),
            "fights%": pc(clip["label"] == 1), "normal%": pc(clip["kind"] == "normal"),
            "hugs%": pc((clip["dataset"] == "AIRTLab") & (clip["label"] == 0)), "weapon%": pc(clip["kind"] == "weapon"),
            "KTH%": pc(clip["dataset"] == "KTH"), "own non-violent%": pc((clip["dataset"] == "OwnRec") & (clip["label"] == 0)),
            "fast slice FIGHT% (windows)": pw(wf["fast_neg"].to_numpy()),
            "normal FIGHT% (windows)": pw((wf["kind"] == "normal").to_numpy())}


def step_report(w):
    lg = pd.read_csv(OOF_LGBM)
    sq = pd.read_csv(OOF_SEQ)[["path", "end_s", "p"]].rename(columns={"p": "p_cnn"})
    d = lg.merge(sq.assign(end_s=sq["end_s"].round(2)), on=["path", "end_s"], how="left")
    print(f"{d['p_cnn'].notna().mean():.1%} of LightGBM windows have a CNN score")
    d = d[d["p_cnn"].notna()].reset_index(drop=True)
    names = [c[2:] for c in d.columns if c.startswith("p_") and c != "p_cnn"]
    res = {}
    for n in names:
        res[f"{n} (LightGBM)"] = evaluate(d, d[f"p_{n}"].to_numpy())
        res[f"{n} + CNN"] = evaluate(d, (d[f"p_{n}"] + d["p_cnn"]).to_numpy() / 2)
        print(f"evaluated {n}", flush=True)
    res["CNN alone"] = evaluate(d, d["p_cnn"].to_numpy())
    t = pd.DataFrame(res).T
    t["hug ok"] = t["hugs%"] <= HUG_LIMIT
    t["speed ok"] = t["fast slice FIGHT% (windows)"] <= t["normal FIGHT% (windows)"]
    pd.set_option("display.width", 300)
    print("\n=== Candidates (training part, out-of-fold, matched 9% normal false alarms) ===")
    print(t.to_string())
    ok = t[t["hug ok"] & t["speed ok"]].sort_values("clip_auc", ascending=False)
    pick = ok.index[0] if len(ok) else None
    print(f"\nPass both guardrails: {list(ok.index)}\nPick (highest clip AUC): {pick}")
    two_key = None
    if pick:
        p = (d[f"p_{pick.split(' ')[0]}"] + d["p_cnn"]).to_numpy() / 2 if "+ CNN" in pick else d[f"p_{pick.split(' ')[0]}"].to_numpy()
        two_key = evaluate(d, p, {"two_key": True, "two_key_cue": "impact"})
        print("\nPick with TWO_KEY (impact + reaction as the physical cue):", two_key)
    OUT_JSON.write_text(json.dumps({"results": res, "pick": pick, "pick_two_key_impact": two_key}, indent=2, default=float))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", required=True, choices=["weights", "lgbm", "report"])
    args = ap.parse_args()
    warnings.filterwarnings("ignore")
    {"weights": step_weights, "lgbm": step_lgbm, "report": step_report}[args.step](labelled_windows())


if __name__ == "__main__":
    main()
