"""
seq_dataset.py - Build sequence-model inputs (seq_features.sequence_input) for every window of every
clip, with exactly the same windows as train.py (one every STEP_S), so LightGBM and sequence-model
scores line up window by window for the ensemble.

Writes seq_windows.npz: X (n, 20, 2, 17, 4) float16 plus path, end_s, label, dataset, kind, group_id,
holdout (1 = hold-out clip: built now for step 5, never used for training or tuning).

Usage:  python seq_dataset.py        # parallel over CPU cores
"""
import os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd
from tqdm import tqdm

from features import LONG_S, SHORT_S
from seq_features import sequence_input
from train import STEP_S, VIDEOS_CSV, kp_path

# ---------------- Tunable constants ----------------
HOLDOUT_CSV = Path("holdout_groups.csv")
OUT_NPZ = Path("seq_windows.npz")
N_JOBS = max(1, (os.cpu_count() or 2) - 1)
# ---------------------------------------------------


def video_sequences(path):
    """Same window ends as train.video_windows."""
    kp = pd.read_csv(kp_path(path))
    tmax = kp["time_s"].max() if len(kp) else SHORT_S
    ends = np.arange(SHORT_S, max(tmax, SHORT_S) + 0.1 + 1e-6, STEP_S)
    xs = [sequence_input(kp[(kp["time_s"] > e - LONG_S - 0.1) & (kp["time_s"] <= e)], e) for e in ends]
    return path, np.round(ends, 2), np.stack(xs).astype(np.float16)


def main():
    videos = pd.read_csv(VIDEOS_CSV)
    hold = set(pd.read_csv(HOLDOUT_CSV)["path"])
    with ProcessPoolExecutor(max_workers=N_JOBS) as pool:
        results = list(tqdm(pool.map(video_sequences, videos["path"], chunksize=8),
                            total=len(videos), desc="sequences", unit="video"))
    meta = videos.set_index("path")
    paths = np.concatenate([[p] * len(e) for p, e, _ in results])
    m = meta.loc[paths]
    np.savez_compressed(OUT_NPZ, X=np.concatenate([x for _, _, x in results]),
                        path=paths, end_s=np.concatenate([e for _, e, _ in results]),
                        label=m["label"].to_numpy(), dataset=m["dataset"].to_numpy(), kind=m["kind"].to_numpy(),
                        group_id=m["group_id"].to_numpy(), holdout=np.isin(paths, list(hold)).astype(np.int8))
    print(f"{len(paths)} windows from {len(videos)} clips -> {OUT_NPZ}")


if __name__ == "__main__":
    main()
