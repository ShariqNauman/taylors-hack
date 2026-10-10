"""
seq_final.py - Step 5 sequence models (GPU server), same architecture and weights as seq_train.py.

  trainpart  train on the 85% training part (early stopping on a group split of it), then score the
             hold-out windows -> holdout_seq.csv. No hold-out metric is computed here.
  all        train on all data (training part + hold-out) -> seq_model.onnx (the final model)

Usage:  python seq_final.py          # both
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import torch

import seq_train as S

# ---------------- Tunable constants ----------------
HOLDOUT_OUT = Path("holdout_seq.csv")
TRAINPART_ONNX = Path("seq_trainpart.onnx")
FINAL_ONNX = Path("seq_model.onnx")
INFO_JSON = Path("seq_final.json")
# ---------------------------------------------------


def export(model, path):
    model.eval().cpu()
    torch.onnx.export(model, torch.zeros(1, 20, 2, 17, 4), str(path), input_names=["x"],
                      output_names=["logit"], opset_version=17, dynamo=False)
    model.to(S.DEV)


def main():
    torch.manual_seed(S.SEED)
    rng = np.random.default_rng(S.SEED)
    d = np.load(S.DATA_NPZ, allow_pickle=True)  # our own file from seq_dataset.py
    X, y = d["X"], d["label"].astype(np.float32)
    paths, groups, dataset, hold = d["path"], d["group_id"], d["dataset"], d["holdout"] == 1
    clip = json.loads(S.CLIP_JSON.read_text())      # from seq_train.py (training part)
    X = S.clip_coords(X, clip["lo"], clip["hi"])
    ok = S.trainable(d)                              # no one-person copies of fights in training
    wcfg = json.loads(S.BEST_LGBM.read_text())["settings"]
    w = pd.Series(dataset).map({"AIRTLab": wcfg["w_airtlab"], "SCF": wcfg["w_cctv"], "SCVD": wcfg["w_cctv"],
                                "RLVS": 1.0}).fillna(1.0).to_numpy()
    w = np.where((dataset == "AIRTLab") & (y == 0), w * wcfg["hug_mult"], w).astype(np.float32)
    info = {"weights": wcfg}

    # ---- Training part only -> hold-out scores ----
    model, val_auc, epoch = S.train_fold(X, y, w, paths, groups, ~hold & ok, rng)
    pd.DataFrame({"path": paths[hold], "end_s": d["end_s"][hold], "p": S.predict(model, X[hold])}).to_csv(
        HOLDOUT_OUT, index=False)
    export(model, TRAINPART_ONNX)
    info["trainpart"] = {"val_clip_auc": val_auc, "best_epoch": epoch, "n_windows": int((~hold).sum())}
    print(f"training part: best epoch {epoch}, val clip AUC {val_auc:.4f} -> {HOLDOUT_OUT}", flush=True)

    # ---- All data -> final model ----
    model, val_auc, epoch = S.train_fold(X, y, w, paths, groups, ok, rng)
    export(model, FINAL_ONNX)
    info["all"] = {"val_clip_auc": val_auc, "best_epoch": epoch, "n_windows": int(ok.sum())}
    print(f"all data: best epoch {epoch}, val clip AUC {val_auc:.4f} -> {FINAL_ONNX}")
    INFO_JSON.write_text(json.dumps(info, indent=2, default=float))


if __name__ == "__main__":
    main()
