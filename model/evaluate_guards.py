"""
evaluate_guards.py - Sensitivity presets x live guards on the hold-out (second look), with the exact live
logic (guards.LevelLogic).

Presets (both chosen on the TRAINING PART only, out-of-fold ensemble scores, full-body clips):
  strict     FIGHT_AT where 9% of normal clips reach FIGHT (= the v5 threshold, 0.656)
  sensitive  FIGHT_AT where SENSITIVE_FA of normal clips reach FIGHT
Guards: off, each one alone, all on. CLIP_FEATURES off means LightGBM scores the raw (unclipped) features;
the CNN's coordinate clipping is always on (it is part of how that model was trained).

Reports per framing (full, waist-up, chest-up, single, close): fights caught, normal -> FIGHT,
hugs -> FIGHT, weapon caught, any clip -> FIGHT.

Usage:  python evaluate_guards.py
"""
import json
import warnings
from dataclasses import replace
from pathlib import Path

import numpy as np
import pandas as pd

import train as T
import train_halfbody as H
from features import FEATURE_NAMES
from guards import Config, LevelLogic

# ---------------- Tunable constants ----------------
SENSITIVE_FA = 0.15      # "sensitive" preset: normal-clip false alarm rate on the training part
OUT_JSON = Path("guards_results.json")
GUARDS = {"PROX": dict(prox_max=2.0), "TWO_KEY": dict(two_key=True), "K_OF_N": dict(k_of_n=(3, 4)),
          "MIN_TRACK": dict(min_track=True)}
# ---------------------------------------------------


def clip_fight(win, p, cfg):
    """Per clip: did the live logic reach FIGHT?"""
    rows = []
    for path, g in win.assign(p=p).groupby("path", sort=False):
        logic, fought = LevelLogic(cfg), False
        for rec in g.to_dict("records"):
            level, _, _ = logic.step(rec["end_s"], rec["p"], rec)
            fought |= level == "FIGHT"
        rows.append({"path": path, "dataset": rec["dataset"], "kind": rec["kind"], "label": rec["label"],
                     "crop": rec["crop"], "fight": fought})
    return pd.DataFrame(rows)


def summary(c):
    pct = lambda m: round(100 * c.loc[m, "fight"].mean(), 1) if m.any() else None
    out = {}
    for v in H.VARIANTS:
        m = c["crop"] == v
        out[v] = {"fights%": pct(m & (c["label"] == 1)), "normal%": pct(m & (c["kind"] == "normal")),
                  "hugs%": pct(m & (c["dataset"] == "AIRTLab") & (c["label"] == 0)),
                  "weapon%": pct(m & (c["kind"] == "weapon")), "any%": pct(m)}
    return out


def main():
    warnings.filterwarnings("ignore", category=UserWarning)
    win = H.load()

    # ---- presets from the training part (out-of-fold ensemble, full-body clips, single-person rule) ----
    lg = pd.read_csv(H.OOF_LGBM)
    sq = pd.read_csv(H.OOF_SEQ)[["path", "end_s", "p"]].assign(end_s=lambda d: d["end_s"].round(2))
    w = lg.merge(sq, on=["path", "end_s"], suffixes=("_lgbm", "_seq"))
    w = w[w["crop"] == "full"]
    s = T.sustained_scores(w, ((w["p_lgbm"] + w["p_seq"]) / 2).to_numpy())
    presets = {"strict": T.at_matched_fa(s, 0.09)["FIGHT_AT"], "sensitive": T.at_matched_fa(s, SENSITIVE_FA)["FIGHT_AT"]}
    print("Presets (training part):", presets)

    # ---- hold-out scores, LightGBM with and without feature clipping ----
    hold = win[win["is_hold"]].reset_index(drop=True)
    tr = win[~win["is_hold"] & win["trainable"]].reset_index(drop=True)
    best = json.loads(H.BEST_LGBM.read_text())["settings"]
    ranges = H.clip_ranges(tr)
    model = H.fit(tr, best, ranges)
    hs = pd.read_csv(H.HOLDOUT_SEQ).assign(end_s=lambda d: d["end_s"].round(2))
    p_seq = hold[["path", "end_s"]].merge(hs, on=["path", "end_s"], how="left")["p"].to_numpy()
    p = {True: (model.predict_proba(H.clip(hold[FEATURE_NAMES], ranges))[:, 1] + p_seq) / 2,
         False: (model.predict_proba(hold[FEATURE_NAMES])[:, 1] + p_seq) / 2}

    res = {}
    combos = [("all off", {}, False)] + [(f"{g} only", kw, False) for g, kw in GUARDS.items()] + \
             [("CLIP_FEATURES only", {}, True), ("all on", {k: v for kw in GUARDS.values() for k, v in kw.items()}, True)]
    for preset, fa in presets.items():
        for name, kw, clip_on in combos:
            cfg = replace(Config(alpha=T.LIVE["SMOOTH_ALPHA"], tense_at=T.LIVE["TENSE_AT"], fight_at=fa,
                                 min_duration=T.LIVE["MIN_DURATION"]), **kw)
            res[f"{preset} | {name}"] = summary(clip_fight(hold, p[clip_on], cfg))
            print(f"done: {preset} | {name}", flush=True)

    rows = []
    for k, r in res.items():
        rows.append({"setting": k, "full fights%": r["full"]["fights%"], "full normal%": r["full"]["normal%"],
                     "full hugs%": r["full"]["hugs%"], "full weapon%": r["full"]["weapon%"],
                     "waist fights%": r["waist-up"]["fights%"], "chest fights%": r["chest-up"]["fights%"],
                     "chest hugs%": r["chest-up"]["hugs%"],
                     "single any%": r["single"]["any%"], "close any%": r["close"]["any%"]})
    table = pd.DataFrame(rows).set_index("setting")
    print("\n=== HOLD-OUT (second look): presets x guards ===")
    print(table.to_string())
    OUT_JSON.write_text(json.dumps({"presets": presets, "results": res, "table": table.reset_index().to_dict("records")},
                                   indent=2, default=float))


if __name__ == "__main__":
    main()
