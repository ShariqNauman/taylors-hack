"""
diagnose_speed.py - Does v5 detect violence, or just fast movement? TRAINING PART only.

  1. Correlation (Spearman) of the v5 out-of-fold window score with body speed (energy_max = all-joint
     speed of the more active person) inside non-violent clips, overall and within each clip.
  2. "Fast non-violent" slice: the top FAST_PCT of non-violent training windows by energy_max, plus every
     KTH running / walking window (never trained on; scored with the final v5 models).
  3. On each slice, at the matched 9% threshold (FIGHT_AT 0.656) with the live logic (guards.LevelLogic,
     default settings): % of windows at FIGHT, and % "hot" (smoothed score >= FIGHT_AT, i.e. what the
     score alone says before the single-person rule caps it). Compared with slow non-violent windows and
     with fight windows.

Usage:  python diagnose_speed.py
"""
import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

import train as T
import train_halfbody as H
from guards import Config, LevelLogic
from predict import predict
from seq_features import window_inputs

# ---------------- Tunable constants ----------------
FAST_PCT = 0.20          # top share of non-violent windows by body speed = "fast non-violent"
SPEED = "energy_max"     # body speed measure: all-joint speed of the more active person (torso lengths / s)
OUT_JSON = Path("speed_bias.json")
# ---------------------------------------------------


def replay(win, p, cfg):
    """Live logic per clip; returns per-window level and smoothed score."""
    levels, smooth = np.empty(len(win), object), np.zeros(len(win))
    for _, idx in win.groupby("path", sort=False).indices.items():
        logic = LevelLogic(cfg)
        for i in idx:
            levels[i], smooth[i], _ = logic.step(win["end_s"].iat[i], p[i], win.iloc[i].to_dict())
    return levels, smooth


def kth_windows(videos):
    """KTH windows scored with the final v5 models (KTH was never in training)."""
    rows = []
    for path in videos.loc[videos["dataset"] == "KTH", "path"]:
        kp = T.load_kp(path)
        if kp.empty:
            continue
        for e in np.arange(T.SHORT_S, kp["time_s"].max() + 0.1 + 1e-6, T.STEP_S):
            f, s = window_inputs(kp[(kp["time_s"] > e - T.LONG_S - 0.1) & (kp["time_s"] <= e)], e)
            rows.append({**f, "path": path, "end_s": round(e, 2), "p": predict(f, s), "label": 0,
                         "dataset": "KTH", "kind": "run_walk"})
    return pd.DataFrame(rows)


def main():
    warnings.filterwarnings("ignore")
    cfg = Config(alpha=T.LIVE["SMOOTH_ALPHA"], tense_at=T.LIVE["TENSE_AT"], fight_at=T.LIVE["FIGHT_AT"],
                 min_duration=T.LIVE["MIN_DURATION"])
    videos = pd.read_csv(T.VIDEOS_CSV)

    # ---- training part, full-body clips, v5 out-of-fold ensemble scores ----
    lg = pd.read_csv(H.OOF_LGBM)
    sq = pd.read_csv(H.OOF_SEQ)[["path", "end_s", "p"]].assign(end_s=lambda d: d["end_s"].round(2))
    oof = lg.merge(sq, on=["path", "end_s"], suffixes=("_lgbm", "_seq"))
    oof = oof[oof["crop"] == "full"].assign(p=lambda d: (d["p_lgbm"] + d["p_seq"]) / 2)
    win = pd.read_csv(T.WINDOWS_CACHE)
    win["end_s"] = win["end_s"].round(2)
    tr = oof[["path", "end_s", "p", "label", "dataset", "kind"]].merge(win.drop(columns=["feat_hash"]),
                                                                      on=["path", "end_s"])
    tr = tr.sort_values(["path", "end_s"], ignore_index=True)
    tr["level"], tr["smooth"] = replay(tr, tr["p"].to_numpy(), cfg)
    print(f"Training part: {tr['path'].nunique()} full-body clips, {len(tr)} windows (out-of-fold v5 scores)")

    # ---- 1. correlation with body speed inside non-violent clips ----
    nv = tr[(tr["label"] == 0) & tr[SPEED].notna()]
    rho_all = spearmanr(nv[SPEED], nv["p"]).correlation
    per_clip = [spearmanr(g[SPEED], g["p"]).correlation for _, g in nv.groupby("path") if len(g) >= 5 and g[SPEED].nunique() > 2]
    fv = tr[(tr["label"] == 1) & tr[SPEED].notna()]
    corr = {"non-violent windows, all": round(rho_all, 3),
            "non-violent, within clip (median)": round(float(np.nanmedian(per_clip)), 3),
            "fight windows, all (for comparison)": round(spearmanr(fv[SPEED], fv["p"]).correlation, 3)}
    print("\n1. Spearman correlation of v5 score with body speed:", corr)

    # ---- 2 + 3. slices ----
    cut = nv[SPEED].quantile(1 - FAST_PCT)
    kth = kth_windows(videos)
    kth = kth.sort_values(["path", "end_s"], ignore_index=True)
    kth["level"], kth["smooth"] = replay(kth, kth["p"].to_numpy(), cfg)
    fa = cfg.fight_at
    slices = {
        f"fast non-violent (top {FAST_PCT:.0%} speed, {SPEED} >= {cut:.2f})": nv[nv[SPEED] >= cut],
        "KTH running + walking (unseen)": kth,
        "slow non-violent (other 80%)": nv[nv[SPEED] < cut],
        "fight windows": tr[tr["label"] == 1],
    }
    rows = []
    for name, d in slices.items():
        rows.append({"slice": name, "windows": len(d), "median speed": round(float(d[SPEED].median()), 2),
                     "mean score": round(float(d["p"].mean()), 3),
                     "hot % (score >= FIGHT_AT)": round(100 * (d["smooth"] >= fa).mean(), 1),
                     "FIGHT % (live logic)": round(100 * (d["level"] == "FIGHT").mean(), 1),
                     "clips reaching FIGHT %": round(100 * d.groupby("path")["level"].apply(lambda s: (s == "FIGHT").any()).mean(), 1)})
    table = pd.DataFrame(rows).set_index("slice")
    pd.set_option("display.width", 250)
    print(f"\n2-3. Slices at FIGHT_AT {fa} (9% normal false alarms on the training part):")
    print(table.to_string())
    by_kind = kth.groupby(kth["path"].str.contains("running")).agg(
        windows=("p", "size"), mean_score=("p", "mean"), hot=("smooth", lambda s: 100 * (s >= fa).mean()))
    by_kind.index = by_kind.index.map({True: "running", False: "walking"})
    print("\nKTH by action:"); print(by_kind.round(3).to_string())
    print(f"KTH people per window: mean {kth['n_people'].mean():.2f} (the single-person rule caps one person at TENSE)")
    OUT_JSON.write_text(json.dumps({"correlation": corr, "fast_cut": float(cut), "fight_at": fa,
                                    "slices": table.reset_index().to_dict("records"),
                                    "kth_by_action": by_kind.reset_index().to_dict("records")}, indent=2, default=float))


if __name__ == "__main__":
    main()
