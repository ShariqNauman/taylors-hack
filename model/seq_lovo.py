"""
seq_lovo.py - Leave-one-video-out CNN scores for our own recordings (GPU server).
For each own video: train on the training part without that video (same settings, weights and labels as
seq_train.py / weights_v6.csv), then score that video's full-body windows -> own_lovo_seq.csv.

Usage:  python seq_lovo.py
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import torch

import seq_train as S

# ---------------- Tunable constants ----------------
OUT_CSV = Path("own_lovo_seq.csv")
# ---------------------------------------------------


def main():
    torch.manual_seed(S.SEED)
    rng = np.random.default_rng(S.SEED)
    d = np.load(S.DATA_NPZ, allow_pickle=True)  # our own file from seq_dataset.py
    clip = json.loads(S.CLIP_JSON.read_text())
    X = S.clip_coords(d["X"], clip["lo"], clip["hi"])
    w, y, ok = S.v6_table(d)
    y = np.nan_to_num(y.astype(float)).astype(np.float32)
    paths, groups, hold = d["path"], d["group_id"], d["holdout"] == 1
    own = (d["dataset"] == "OwnRec") & (d["crop"] == "full")
    rows = []
    for g in np.unique(groups[own]):
        test = own & (groups == g)
        model, val_auc, epoch = S.train_fold(X, y, w, paths, groups, ~hold & ok & (groups != g), rng)
        rows.append(pd.DataFrame({"path": paths[test], "end_s": d["end_s"][test], "p": S.predict(model, X[test])}))
        print(f"video group {g}: {test.sum()} windows, best epoch {epoch}", flush=True)
    pd.concat(rows).to_csv(OUT_CSV, index=False)
    print(f"-> {OUT_CSV}")


if __name__ == "__main__":
    main()
