"""
seq_features.py - Input for the sequence model: the active pair's keypoints over the last 2 s.
Shared by training (seq_dataset.py) and live, like features.window_features.

sequence_input(kp, t_end) -> float32 array (STEPS, 2, 17, 4):
  STEPS = 20 time steps (last LONG_S seconds at FEATURE_FPS, oldest first)
  2     = the two people of the active pair (same choice as features.py: fastest wrists)
  17    = COCO keypoints, face included
  4     = x, y (centred on the pair, divided by torso length), keypoint confidence, present (0/1)
A missing person or time step is all zeros (present = 0). With only one person, slot 1 stays empty.
"""
import numpy as np
import pandas as pd

from features import FEATURE_FPS, LONG_S, _active_pair, _people, resample_window

# ---------------- Tunable constants ----------------
STEPS = int(round(FEATURE_FPS * LONG_S))   # 20
MIN_KP_CONF = 0.1        # keypoints below this confidence are zeroed (present stays 1 for the person)
# ---------------------------------------------------

KEYPOINTS = ["nose", "l_eye", "r_eye", "l_ear", "r_ear",
             "l_shoulder", "r_shoulder", "l_elbow", "r_elbow", "l_wrist", "r_wrist",
             "l_hip", "r_hip", "l_knee", "r_knee", "l_ankle", "r_ankle"]
# Index of each keypoint's left/right mirror, for flip augmentation.
FLIP = [KEYPOINTS.index(k.replace("l_", "#").replace("r_", "l_").replace("#", "r_")) for k in KEYPOINTS]


def sequence_input(kp: pd.DataFrame, t_end: float, frame_times=None) -> np.ndarray:
    out = np.zeros((STEPS, 2, len(KEYPOINTS), 4), np.float32)
    win = resample_window(kp, t_end, frame_times)
    if win is None or win.empty:
        return out
    people = _people(win)
    if not people:
        return out
    pair = _active_pair(people)
    by_obj = {id(p): pid for pid, p in people.items()}
    if pair is not None:
        chosen = [pair[0], pair[1]]
    else:  # nobody to pair with: the person with the fastest wrists, slot 1 empty
        chosen = [max(people.values(), key=lambda p: np.nan_to_num(p.max_wrist_speed()))]
    ids = [by_obj[id(p)] for p in chosen]

    # Centre on the pair (mean torso centre over the window) and scale by their mean torso length.
    centres = np.concatenate([p.centre for p in chosen])
    centre = np.nanmean(centres, axis=0) if np.isfinite(centres).any() else np.zeros(2)
    scale = float(np.mean([p.scale for p in chosen]))

    grid = t_end - np.arange(STEPS)[::-1] / FEATURE_FPS   # oldest first
    xy = np.stack([win[[f"{k}_x", f"{k}_y"]].to_numpy(float) for k in KEYPOINTS], axis=1)  # (N, 17, 2)
    conf = np.stack([win[f"{k}_conf"].to_numpy(float) for k in KEYPOINTS], axis=1)       # (N, 17)
    t, pid = win["time_s"].to_numpy(float), win["person_id"].to_numpy()
    for slot, p in enumerate(ids):
        rows = np.where(pid == p)[0]
        for r in rows:
            step = int(np.argmin(np.abs(grid - t[r])))
            if abs(grid[step] - t[r]) > 0.5 / FEATURE_FPS:
                continue
            ok = conf[r] >= MIN_KP_CONF
            out[step, slot, :, 0] = np.where(ok, (xy[r, :, 0] - centre[0]) / scale, 0)
            out[step, slot, :, 1] = np.where(ok, (xy[r, :, 1] - centre[1]) / scale, 0)
            out[step, slot, :, 2] = np.where(ok, conf[r], 0)
            out[step, slot, :, 3] = 1.0
    return out
