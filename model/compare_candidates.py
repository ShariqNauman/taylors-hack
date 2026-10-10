"""
compare_candidates.py - Step 4 "How to choose" of TRAINING_PLAN.md, on the TRAINING PART only.

Candidates (all out-of-fold on the same folds.csv):
  LightGBM alone    oof_lgbm.csv (tune_lgbm.py pick)
  sequence alone    oof_seq.csv  (seq_train.py)
  ensemble          average of the two probabilities, window by window
For each: clip AUC overall and per dataset; at its own matched threshold (FIGHT_AT where 9% of normal
clips reach FIGHT): fights, AIRTLab hugs/claps, weapon clips reaching FIGHT; laptop time per window.

Pick rule: reject candidates whose hug rate > HUG_LIMIT (old-10's rate) or > LightGBM alone's, or
slower than MAX_MS per window; pick the highest clip AUC; if the gain over LightGBM alone is under
MIN_GAIN, keep LightGBM alone.

Usage:  python compare_candidates.py
"""
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

import train as T

# ---------------- Tunable constants ----------------
OOF_LGBM = Path("oof_lgbm.csv")
OOF_SEQ = Path("oof_seq.csv")
SEQ_ONNX = Path("seq_fold0.onnx")
OUT_JSON = Path("candidates.json")
HUG_LIMIT = 18.6
MAX_MS = 20.0
MIN_GAIN = 0.01
TIMING_RUNS = 300
# ---------------------------------------------------


def seq_model_ms():
    """OpenVINO inference time per window for the sequence model, on the laptop (GPU and CPU)."""
    import openvino as ov
    core, x = ov.Core(), np.random.rand(1, 20, 2, 17, 4).astype(np.float32)
    out = {}
    for dev in ("GPU", "CPU"):
        if dev not in core.available_devices:
            continue
        compiled = core.compile_model(str(SEQ_ONNX), dev)
        for _ in range(20):
            compiled(x)
        t0 = time.perf_counter()
        for _ in range(TIMING_RUNS):
            compiled(x)
        out[dev] = 1000 * (time.perf_counter() - t0) / TIMING_RUNS
    return out


def input_ms():
    """Time to build one window's inputs (features for LightGBM, sequence for the CNN) on a real clip."""
    from features import window_features
    from seq_features import sequence_input
    import joblib
    kp = pd.read_csv("keypoints_v2/AIRTLab/joking_violent/cam1/37.csv")
    ends = np.arange(2.0, kp["time_s"].max(), 0.5)
    sl = [kp[(kp["time_s"] > e - 2.1) & (kp["time_s"] <= e)] for e in ends]
    t0 = time.perf_counter(); feats = [window_features(s, e) for s, e in zip(sl, ends)]
    f_ms = 1000 * (time.perf_counter() - t0) / len(ends)
    t0 = time.perf_counter(); [sequence_input(s, e) for s, e in zip(sl, ends)]
    s_ms = 1000 * (time.perf_counter() - t0) / len(ends)
    bundle = joblib.load(T.MODEL_OUT)  # our own model file (only for timing a LightGBM predict)
    X = pd.DataFrame([feats[0]])[bundle["features"]] if set(bundle["features"]) <= set(feats[0]) else None
    t0 = time.perf_counter()
    for _ in range(100):
        bundle["model"].predict_proba(X)
    return {"features_ms": f_ms, "sequence_input_ms": s_ms, "lgbm_predict_ms": 10 * (time.perf_counter() - t0)}


def evaluate(win, p):
    clips = T.sustained_scores(win, p)
    return {"clip_auc": round(T.auc(clips), 4),
            **{f"auc_{d}": round(T.auc(c), 4) for d, c in clips.groupby("dataset")},
            **T.at_matched_fa(clips)}


def main():
    lg = pd.read_csv(OOF_LGBM).assign(end_s=lambda d: d["end_s"].round(2))
    sq = pd.read_csv(OOF_SEQ)[["path", "end_s", "p"]].assign(end_s=lambda d: d["end_s"].round(2))
    win = lg.merge(sq, on=["path", "end_s"], suffixes=("_lgbm", "_seq"), how="inner")
    print(f"{len(win)} windows matched ({len(lg)} LightGBM, {len(sq)} sequence), "
          f"{win['path'].nunique()} training-part clips")
    assert (win.groupby("path")["fold"].nunique() == 1).all()

    res = {"LightGBM alone": evaluate(win, win["p_lgbm"].to_numpy()),
           "sequence alone": evaluate(win, win["p_seq"].to_numpy()),
           "ensemble (mean)": evaluate(win, (win["p_lgbm"] + win["p_seq"]).to_numpy() / 2)}

    t_in, t_seq = input_ms(), seq_model_ms()
    seq_dev = "GPU" if "GPU" in t_seq else "CPU"
    res["LightGBM alone"]["ms_per_window"] = t_in["features_ms"] + t_in["lgbm_predict_ms"]
    res["sequence alone"]["ms_per_window"] = t_in["sequence_input_ms"] + t_seq[seq_dev]
    res["ensemble (mean)"]["ms_per_window"] = (res["LightGBM alone"]["ms_per_window"]
                                               + res["sequence alone"]["ms_per_window"])
    table = pd.DataFrame(res).T
    print(f"\n=== Candidates (out-of-fold, training part; matched to 9% normal false alarms) ===")
    print(table.round(3).to_string())
    print(f"\nLaptop timing (ms per window): {t_in} | sequence model OpenVINO: "
          f"{ {k: round(v, 2) for k, v in t_seq.items()} }")

    base = res["LightGBM alone"]
    ok = {k: r for k, r in res.items()
          if r["hugs%"] <= HUG_LIMIT and r["hugs%"] <= base["hugs%"] and r["normal%"] <= base["normal%"]
          and r["ms_per_window"] < MAX_MS}
    print(f"\nPass the rules (hugs <= {HUG_LIMIT}% and <= LightGBM's, normal <= LightGBM's, "
          f"< {MAX_MS} ms): {list(ok)}")
    best = max(ok, key=lambda k: ok[k]["clip_auc"]) if ok else None
    if best and best != "LightGBM alone" and ok[best]["clip_auc"] - base["clip_auc"] < MIN_GAIN:
        print(f"{best} gains only {ok[best]['clip_auc'] - base['clip_auc']:+.4f} AUC (< {MIN_GAIN}): "
              "keep LightGBM alone")
        best = "LightGBM alone"
    print(f"Choice: {best}")
    OUT_JSON.write_text(json.dumps({"candidates": res, "timing": {**t_in, "seq_openvino": t_seq},
                                    "choice": best}, indent=2, default=float))


if __name__ == "__main__":
    main()
