"""
seq_features.py - Input for the sequence model: the active pair's keypoints over the last 2 s.
Shared by training (seq_dataset.py) and live, like features.window_features.

sequence_input(kp, t_end) -> float32 array (STEPS, 2, 17, CHANNELS):
  STEPS = 20 time steps (last LONG_S seconds at FEATURE_FPS, oldest first)
  2     = the two people of the active pair (same choice as features.py: fastest wrists)
  17    = COCO keypoints, face included
  8     = x, y (centred on the pair, divided by torso length), keypoint confidence, present (0/1),
          x, y relative to the person's own body centre (v6), and the other person's centre relative to
          this person (v6, same value for all 17 points)
A missing person or time step is all zeros (present = 0). With only one person, slot 1 stays empty.
"""
import numpy as np
import pandas as pd

from features import FEATURE_FPS, LONG_S, _active_pair, _people, compute_features, resample_window

# ---------------- Tunable constants ----------------
STEPS = int(round(FEATURE_FPS * LONG_S))   # 20
MIN_KP_CONF = 0.1        # keypoints below this confidence are zeroed (present stays 1 for the person)
CHANNELS = 8             # per keypoint: x, y (pair-centred), conf, present, x, y (body-centred), other person dx, dy
X_CHANNELS = (0, 4, 6)   # channels holding x (negated by the left-right flip augmentation)
COORD_CHANNELS = (0, 1, 4, 5, 6, 7)  # channels clipped to the training range
# ---------------------------------------------------

KEYPOINTS = ["nose", "l_eye", "r_eye", "l_ear", "r_ear",
             "l_shoulder", "r_shoulder", "l_elbow", "r_elbow", "l_wrist", "r_wrist",
             "l_hip", "r_hip", "l_knee", "r_knee", "l_ankle", "r_ankle"]
# Index of each keypoint's left/right mirror, for flip augmentation.
FLIP = [KEYPOINTS.index(k.replace("l_", "#").replace("r_", "l_").replace("#", "r_")) for k in KEYPOINTS]


def window_inputs(kp: pd.DataFrame, t_end: float, frame_times=None):
    """Both model inputs for one window with a single resample + people-finding pass (the slow part):
    returns (LightGBM feature dict, sequence array). Same results as window_features + sequence_input."""
    win = resample_window(kp, t_end, frame_times)
    if win is None or win.empty:
        return compute_features(win, t_end), np.zeros((STEPS, 2, len(KEYPOINTS), CHANNELS), np.float32)
    people = _people(win)
    return compute_features(win, t_end, people), _sequence(win, people, t_end)


def sequence_input(kp: pd.DataFrame, t_end: float, frame_times=None) -> np.ndarray:
    win = resample_window(kp, t_end, frame_times)
    if win is None or win.empty:
        return np.zeros((STEPS, 2, len(KEYPOINTS), CHANNELS), np.float32)
    return _sequence(win, _people(win), t_end)


def _sequence(win, people, t_end):
    """Sequence array from an already resampled window and its people."""
    out = np.zeros((STEPS, 2, len(KEYPOINTS), CHANNELS), np.float32)
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
    # Each person's own body centre per frame time (for body-centred limbs and the pair's relative position).
    own_c = [dict(zip(np.round(p.t, 4), p.centre)) for p in chosen]
    for slot, p in enumerate(ids):
        rows = np.where(pid == p)[0]
        other = own_c[1 - slot] if len(chosen) == 2 else {}
        for r in rows:
            step = int(np.argmin(np.abs(grid - t[r])))
            if abs(grid[step] - t[r]) > 0.5 / FEATURE_FPS:
                continue
            ok = conf[r] >= MIN_KP_CONF
            out[step, slot, :, 0] = np.where(ok, (xy[r, :, 0] - centre[0]) / scale, 0)
            out[step, slot, :, 1] = np.where(ok, (xy[r, :, 1] - centre[1]) / scale, 0)
            out[step, slot, :, 2] = np.where(ok, conf[r], 0)
            out[step, slot, :, 3] = 1.0
            c = own_c[slot].get(round(t[r], 4))
            if c is not None and np.isfinite(c).all():
                out[step, slot, :, 4] = np.where(ok, (xy[r, :, 0] - c[0]) / scale, 0)
                out[step, slot, :, 5] = np.where(ok, (xy[r, :, 1] - c[1]) / scale, 0)
                o = other.get(round(t[r], 4))
                if o is not None and np.isfinite(o).all():
                    out[step, slot, :, 6] = (o[0] - c[0]) / scale
                    out[step, slot, :, 7] = (o[1] - c[1]) / scale
    return out
