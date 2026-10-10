"""
analyze_v6_features.py - Step 4 report: do the v6 features separate fights from speed? TRAINING PART only,
full-body windows (our own violence videos are left out until fight_times.csv gives their fight seconds).

Per feature: window AUC of fights against
  normal  (kind normal: RLVS / SCF / SCVD non-violent)
  hugs    (AIRTLab non-violent: hugs, claps, high-fives)
  fast    (non-violent windows in the top FAST_PCT body speed with 2+ people: the "fast non-violent" slice)
  KTH     (running / walking, one person)
AUC > 0.5: higher in fights. Strength = distance from 0.5 either way. Plus missing rate.

Usage:  python analyze_v6_features.py
"""
import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

import train_halfbody as H
from features import FEATURE_NAMES

# ---------------- Tunable constants ----------------
FAST_PCT = 0.20
SPEED = "energy_max"
V6_FEATURES = FEATURE_NAMES[FEATURE_NAMES.index("limb_rel_speed_max"):]
COMPARE = ["max_wrist_speed", "energy_max"]     # old speed features, for contrast
OUT_JSON = Path("v6_feature_analysis.json")
# ---------------------------------------------------


def training_windows():
    w = H.load()
    w = w[~w["is_hold"] & (w["crop"] == "full")]
    return w[~((w["dataset"] == "OwnRec") & (w["label"] == 1))].reset_index(drop=True)


def slices(w):
    fights = w[w["label"] == 1]
    nv = w[(w["label"] == 0) & w["dataset"].isin(["RLVS", "SCF", "SCVD", "AIRTLab"])]
    cut = nv[SPEED].quantile(1 - FAST_PCT)
    return fights, {"normal": w[w["kind"] == "normal"],
                    "hugs": w[(w["dataset"] == "AIRTLab") & (w["label"] == 0)],
                    "fast": nv[(nv[SPEED] >= cut) & (nv["n_people"] >= 2)],
                    "KTH": w[w["dataset"] == "KTH"]}, cut


def auc(pos, neg, f):
    a, b = pos[f].dropna(), neg[f].dropna()
    if len(a) < 20 or len(b) < 20:
        return np.nan
    return roc_auc_score(np.r_[np.ones(len(a)), np.zeros(len(b))], np.r_[a, b])


def main():
    warnings.filterwarnings("ignore")
    w = training_windows()
    fights, negs, cut = slices(w)
    print(f"Training part, full body: {len(w)} windows. Fights {len(fights)}; " +
          ", ".join(f"{k} {len(v)}" for k, v in negs.items()) + f" (fast = {SPEED} >= {cut:.2f}, 2+ people)")
    rows = []
    for f in V6_FEATURES + COMPARE:
        r = {"feature": f, "missing %": round(100 * w[f].isna().mean(), 1)}
        for k, neg in negs.items():
            r[f"AUC vs {k}"] = round(auc(fights, neg, f), 3)
        rows.append(r)
    t = pd.DataFrame(rows).set_index("feature")
    t["best strength vs fast"] = (t["AUC vs fast"] - 0.5).abs() + 0.5
    pd.set_option("display.width", 250)
    print(t.sort_values("best strength vs fast", ascending=False).drop(columns="best strength vs fast").to_string())
    OUT_JSON.write_text(json.dumps({"fast_cut": float(cut), "table": t.reset_index().to_dict("records")}, indent=2,
                                   default=float))


if __name__ == "__main__":
    main()
