"""
step6_v6.py - Step 6: v6-hn4 + CNN vs v5 (hold-out, third look) and on our own recordings
(leave one video out), then the final v6 model if it is kept.

Steps (--step):
  lgbm    v6-hn4 LightGBM: out-of-fold on the training part (threshold), leave-one-own-video-out, and a
          training-part fit scored on the hold-out -> oof_lgbm_v6f.csv, own_lovo_lgbm.csv, holdout_lgbm_v6.csv
  report  with the server's oof_seq_v6f.csv, holdout_seq_v6f.csv, own_lovo_seq.csv: hold-out table (v5 vs v6
          at each model's own 9% threshold), own-video table, keep rule -> step6_results.json
  final   (only if kept) LightGBM on all data -> violence_model.joblib; v6 CNN -> seq_model.onnx; v5 backed up

Usage:  python step6_v6.py --step lgbm|report|final
"""
import argparse
import json
import shutil
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier

import train as T
import train_halfbody as H
import train_v6 as V
from features import FEATURE_NAMES
from guards import Config, LevelLogic
from run_recorded import analyse
from tune_lgbm import LGBM_KEYS

# ---------------- Tunable constants ----------------
HN = 4.0                          # chosen candidate: v6-hn4 + CNN
OOF_L, OOF_S = Path("oof_lgbm_v6f.csv"), Path("oof_seq_v6f.csv")
LOVO_L, LOVO_S = Path("own_lovo_lgbm.csv"), Path("own_lovo_seq.csv")
HOLD_L, HOLD_S = Path("holdout_lgbm_v6.csv"), Path("holdout_seq_v6f.csv")
V5_HOLD_SEQ = Path("holdout_seq.csv")      # v5 CNN (training part) hold-out scores
V5_FIGHT_AT, V5_TENSE_AT = 0.656, 0.5
TENSE_RATIO = V5_TENSE_AT / V5_FIGHT_AT    # keep v5's TENSE / FIGHT ratio so the amber stage survives
FAST_MAX = 15.0                            # relaxed speed guardrail: fast non-violent -> FIGHT at most 15% ...
MAX_FIGHT_DROP = 3.0                       # keep v6 only if hold-out fights caught drop <= 3 points vs v5
OUT_JSON = Path("step6_results.json")
V5_DIR = Path("backup_v5")
# ---------------------------------------------------


def fit(w, wt, best):
    m = LGBMClassifier(**{k: best[k] for k in LGBM_KEYS}, subsample_freq=1, random_state=42, verbose=-1,
                       deterministic=True, force_row_wise=True)
    return m.fit(w[FEATURE_NAMES], w["label"], sample_weight=wt)


def step_lgbm(w):
    best = json.loads(H.BEST_LGBM.read_text())["settings"]
    tr = V.training_part(w)
    cut = V.speed_cut(tr)
    wt = V.weights(tr, HN, cut, best)
    fold = tr["group_id"].map(pd.read_csv(V.FOLDS_CSV).set_index("group_id")["fold"]).to_numpy()
    p = np.zeros(len(tr))
    for k in range(5):
        p[fold == k] = fit(tr[fold != k], wt[fold != k], best).predict_proba(tr.loc[fold == k, FEATURE_NAMES])[:, 1]
    cols = ["path", "end_s", "label", "dataset", "kind", "crop", "group_id", "n_people", V.SPEED,
            "impact_with_reaction_count", "wrist_toward_speed", "contact_s", "n_people_1s", "pair_min_dist"]
    tr[cols].assign(p=p, fast_neg=V.fast_negatives(tr, cut)).to_csv(OOF_L, index=False)
    print("out-of-fold done", flush=True)
    own = w[(w["dataset"] == "OwnRec") & (w["crop"] == "full")]
    rows = []
    for g in sorted(own["group_id"].unique()):
        keep = (tr["group_id"] != g).to_numpy()
        m = fit(tr[keep], wt[keep], best)
        o = own[own["group_id"] == g]
        rows.append(o[["path", "end_s"]].assign(p=m.predict_proba(o[FEATURE_NAMES])[:, 1]))
        print(f"own video group {g} done", flush=True)
    pd.concat(rows).to_csv(LOVO_L, index=False)
    hold = w[w["is_hold"]]
    hold[["path", "end_s"]].assign(p=fit(tr, wt, best).predict_proba(hold[FEATURE_NAMES])[:, 1]).to_csv(HOLD_L, index=False)
    print(f"-> {OOF_L}, {LOVO_L}, {HOLD_L}")


def merged(w, a, b):
    """Window table w with columns p_a, p_b from two score files (by path, end_s)."""
    for name, f in (("p_a", a), ("p_b", b)):
        s = pd.read_csv(f)[["path", "end_s", "p"]].assign(end_s=lambda d: d["end_s"].round(2)).rename(columns={"p": name})
        w = w.merge(s, on=["path", "end_s"], how="left")
    return w


def levels(w, p, fa, tense):
    cfg = Config(alpha=T.LIVE["SMOOTH_ALPHA"], tense_at=tense, fight_at=fa, min_duration=T.LIVE["MIN_DURATION"])
    lv, sm = np.empty(len(w), object), np.zeros(len(w))
    for _, idx in w.groupby("path", sort=False).indices.items():
        logic = LevelLogic(cfg)
        for i in idx:
            lv[i], sm[i], _ = logic.step(w["end_s"].iat[i], p[i], w.iloc[i].to_dict())
    return lv, sm


def holdout_table(w, p, fa, tense, cut):
    hold = w.assign(p=p, fast_neg=V.fast_negatives(w, cut)).reset_index(drop=True)
    hold["level"], _ = levels(hold, hold["p"].to_numpy(), fa, tense)
    clip = hold.groupby("path").agg(f=("level", lambda s: (s == "FIGHT").any()), label=("label", "first"),
                                    dataset=("dataset", "first"), kind=("kind", "first"), crop=("crop", "first"))
    pc = lambda m: round(100 * clip.loc[m, "f"].mean(), 1)
    full = hold["crop"] == "full"
    r = {"FIGHT_AT": round(fa, 4), "clip AUC": round(T.auc(T.sustained_scores(hold[full], hold.loc[full, "p"].to_numpy())), 4)}
    for crop, tag in (("full", ""), ("waist-up", "waist "), ("chest-up", "chest ")):
        m = clip["crop"] == crop
        r[f"{tag}fights%"] = pc(m & (clip["label"] == 1))
        if crop == "full":
            r.update({"normal%": pc(m & (clip["kind"] == "normal")),
                      "hugs%": pc(m & (clip["dataset"] == "AIRTLab") & (clip["label"] == 0)),
                      "weapon%": pc(m & (clip["kind"] == "weapon"))})
    fw = full & hold["fast_neg"]
    r["fast non-violent FIGHT% (windows)"] = round(100 * (hold.loc[fw, "level"] == "FIGHT").mean(), 1)
    r["normal FIGHT% (windows)"] = round(100 * (hold.loc[full & (hold["kind"] == "normal"), "level"] == "FIGHT").mean(), 1)
    for crop in ("single", "close"):
        r[f"{crop} any%"] = pc(clip["crop"] == crop)
    return r


def v5_own_scores(own):
    """v5 (as shipped, never trained on our videos) on our own windows: LightGBM 24 features + 4-channel CNN."""
    import openvino as ov
    from seq_features import sequence_input
    b = joblib.load(V5_DIR / "violence_model.joblib")       # our own model file
    X = own[b["features"]].astype(float).clip(lower=pd.Series({f: r[0] for f, r in b["clip"].items()}),
                                             upper=pd.Series({f: r[1] for f, r in b["clip"].items()}), axis=1)
    pl = b["model"].predict_proba(X)[:, 1]
    cnn = ov.Core().compile_model(str(V5_DIR / "seq_model.onnx"), "CPU")
    clip = json.loads((V5_DIR / "seq_clip.json").read_text())
    ps = []
    for path, e in zip(own["path"], own["end_s"]):
        kp = T.load_kp(path)
        x = sequence_input(kp[(kp["time_s"] > e - T.LONG_S - 0.1) & (kp["time_s"] <= e)], e)[None, ..., :4]
        np.clip(x[..., :2], clip["lo"], clip["hi"], out=x[..., :2])
        ps.append(1 / (1 + np.exp(-float(np.asarray(cnn(x.astype(np.float32))[0]).ravel()[0]))))
    return (pl + np.array(ps)) / 2


def own_table(own, p, fa, tense, fights):
    rows = []
    for path, g in own.assign(p=p).groupby("path", sort=False):
        g = g.sort_values("end_s")
        lv, sm = levels(g.reset_index(drop=True), g["p"].to_numpy(), fa, tense)
        log = pd.DataFrame({"time_s": g["end_s"].to_numpy(), "level": lv, "smoothed_score": sm, "raw_score": g["p"].to_numpy()})
        name = Path(path).name
        rows.append({"video": name, **analyse(log, fights.get(name, []))})
    return rows


def step_report(w):
    best = json.loads(H.BEST_LGBM.read_text())["settings"]
    tr = V.training_part(w)
    cut = V.speed_cut(tr)
    # ---- thresholds from the training part (out-of-fold, full body, matched 9% normal) ----
    oof = merged(pd.read_csv(OOF_L).assign(end_s=lambda d: d["end_s"].round(2)).drop(columns="p"), OOF_L, OOF_S)
    oof = oof[oof["p_b"].notna()].reset_index(drop=True)
    full = (oof["crop"] == "full").to_numpy()
    p6 = ((oof["p_a"] + oof["p_b"]) / 2).to_numpy()
    fa6 = T.at_matched_fa(T.sustained_scores(oof[full], p6[full]))["FIGHT_AT"]
    tense6 = round(fa6 * TENSE_RATIO, 3)
    print(f"v6 thresholds (training part): FIGHT_AT {fa6:.4f}, TENSE_AT {tense6}")
    # ---- hold-out, third look ----
    hold = w[w["is_hold"]].reset_index(drop=True)
    h6 = merged(hold, HOLD_L, HOLD_S)
    v6 = holdout_table(h6, ((h6["p_a"] + h6["p_b"]) / 2).to_numpy(), fa6, tense6, cut)
    trv5 = H.load()
    trv5 = trv5[~trv5["is_hold"] & trv5["trainable"] & ~trv5["dataset"].isin(["KTH", "OwnRec"])].reset_index(drop=True)
    ranges = H.clip_ranges(trv5)
    # v5 LightGBM (training part) uses the 24 v5 features
    m5 = LGBMClassifier(**{k: best[k] for k in LGBM_KEYS}, subsample_freq=1, random_state=42, verbose=-1,
                        deterministic=True, force_row_wise=True)
    f24 = FEATURE_NAMES[:24]
    r24 = {f: ranges[f] for f in f24}
    from tune_lgbm import sample_weights
    m5.fit(H.clip(trv5[f24], r24), trv5["label"], sample_weight=sample_weights(trv5, best))
    s5 = pd.read_csv(V5_HOLD_SEQ).assign(end_s=lambda d: d["end_s"].round(2))
    p5 = (m5.predict_proba(H.clip(hold[f24], r24))[:, 1]
          + hold[["path", "end_s"]].merge(s5, on=["path", "end_s"], how="left")["p"].to_numpy()) / 2
    v5 = holdout_table(hold, p5, V5_FIGHT_AT, V5_TENSE_AT, cut)
    ht = pd.DataFrame({"v5": v5, "v6-hn4 + CNN": v6}).T
    pd.set_option("display.width", 300)
    print("\n=== HOLD-OUT, third look (each model at its own 9% threshold from the training part) ===")
    print(ht.to_string())
    # ---- own recordings, leave one video out ----
    ft = pd.read_csv(V.FIGHT_TIMES) if V.FIGHT_TIMES.exists() else pd.DataFrame(columns=["file", "fight_start_s", "fight_end_s"])
    fights = {f: list(zip(g["fight_start_s"], g["fight_end_s"])) for f, g in ft.groupby("file")}
    own = w[(w["dataset"] == "OwnRec") & (w["crop"] == "full")].sort_values(["path", "end_s"]).reset_index(drop=True)
    o6 = merged(own, LOVO_L, LOVO_S)
    own6 = own_table(own, ((o6["p_a"] + o6["p_b"]) / 2).to_numpy(), fa6, tense6, fights)
    own5 = own_table(own, v5_own_scores(own), V5_FIGHT_AT, V5_TENSE_AT, fights)
    ot = pd.concat([pd.DataFrame(own5).assign(model="v5"), pd.DataFrame(own6).assign(model="v6 (LOVO)")])
    print("\n=== Own recordings (v6: leave one video out; v5 never trained on them) ===")
    print(ot.to_string(index=False))
    drop = v5["fights%"] - v6["fights%"]
    keep = drop <= MAX_FIGHT_DROP
    print(f"\nHold-out fights caught: v5 {v5['fights%']}% vs v6 {v6['fights%']}% (drop {drop:.1f} points) -> "
          f"{'KEEP v6' if keep else 'KEEP v5'}")
    OUT_JSON.write_text(json.dumps({"thresholds": {"v6": [fa6, tense6], "v5": [V5_FIGHT_AT, V5_TENSE_AT]},
                                    "holdout_third_look": {"v5": v5, "v6": v6}, "own": {"v5": own5, "v6_lovo": own6},
                                    "keep_v6": bool(keep), "fight_drop": drop}, indent=2, default=float))


def step_final(w):
    res = json.loads(OUT_JSON.read_text())
    if not res["keep_v6"]:
        raise SystemExit("step6_results.json says keep v5: nothing to do")
    best = json.loads(H.BEST_LGBM.read_text())["settings"]
    V5_DIR.mkdir(exist_ok=True)
    for f in ("violence_model.joblib", "seq_model.onnx", "seq_clip.json", "proof.json", "metrics_v2.json"):
        if not (V5_DIR / f).exists():
            shutil.copy(f, V5_DIR / f)
    allw = w[w["trainable"]].reset_index(drop=True)
    cut = V.speed_cut(V.training_part(w))
    m = fit(allw, V.weights(allw, HN, cut, best), best)
    fa6, tense6 = res["thresholds"]["v6"]
    joblib.dump({"model": m, "features": FEATURE_NAMES, "name": "lightgbm v6-hn4 (all clips + copies + own videos)",
                 "params": best, "hard_negative_weight": HN, "fight_at": {"ensemble": fa6}, "tense_at": tense6},
                T.MODEL_OUT)
    shutil.copy("seq_model_v6f.onnx", "seq_model.onnx")
    shutil.copy("seq_clip_v6f.json", "seq_clip.json")
    print(f"Saved v6: {T.MODEL_OUT} ({len(allw)} windows), seq_model.onnx; v5 backed up in {V5_DIR}/; "
          f"live FIGHT_AT {fa6:.3f}, TENSE_AT {tense6}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", required=True, choices=["lgbm", "report", "final"])
    args = ap.parse_args()
    warnings.filterwarnings("ignore")
    {"lgbm": step_lgbm, "report": step_report, "final": step_final}[args.step](V.labelled_windows())


if __name__ == "__main__":
    main()
