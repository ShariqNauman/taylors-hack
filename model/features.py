"""
features.py - Turn the last 2 seconds of raw keypoints into fight features.
Shared by train.py and live_detector.py so training and live use the exact same math.

Entry point: window_features(kp, t_end) - keeps only the frames nearest a FEATURE_FPS grid over the
last LONG_S seconds (training and live both go through this, so both see the same frame rate),
then compute_features(). Input is the keypoints CSV format (time_s, person_id, <kp>_x, <kp>_y,
<kp>_conf ..., and in v2 files box_x1, box_y1, box_x2, box_y2). Face keypoints are ignored.
Output: dict {feature_name: value}, NaN if not computable.

All distances are divided by torso length (shoulder midpoint -> hip midpoint), so features don't
depend on distance to the camera. Speeds are torso-lengths per second.

"Active pair" = the two tracked people seen together whose wrists move fastest. All pair
features use that pair, so a calm bystander standing close doesn't hide the real interaction.
"""
import warnings

import numpy as np
import pandas as pd

# ---------------- Tunable constants ----------------
MIN_CONF = 0.5           # wrists / joints below this confidence are ignored for motion
TORSO_MIN_CONF = 0.3     # shoulders / hips below this are ignored for torso centre and length
FEATURE_FPS = 10         # features always see keypoints resampled to this frame rate
MIN_BBOX_POINTS = 3      # keypoints needed for the keypoint-box centre fallback (v1 files without YOLO boxes)
# Torso length when the hips are missing (half-body framing), from other body sizes. Ratios measured on
# ~140k full-body person-frames of the training part (median torso / size; see REPORT.md).
SHOULDER_TO_TORSO = 1.92   # x shoulder width (wide spread: people turn sideways)
EARS_TO_TORSO = 3.01       # x ear-to-ear distance
EYES_TO_TORSO = 8.41       # x eye-to-eye distance
EYE_NOSE_TO_TORSO = 14.29  # x distance from the eye midpoint to the nose
MIN_TORSO_PX = 5.0       # ignore people whose torso is smaller than this (bad detections)
MAX_GAP_S = 0.25         # don't compute speed across gaps longer than this (missed frames)
SHORT_S = 1.0            # the "1 s" features use the last SHORT_S seconds
LONG_S = 2.0             # the "2 s" features use the last LONG_S seconds
MIN_PAIR_FRAMES = 3      # two people must be seen together this often to form a pair
MIN_PAIR_SPAN_S = 0.3    # a pair must be seen over at least this long to measure closing speed
ARM_PAIR_MAX_DIST = 3.0  # only count arm reach toward people within this many torso lengths
PEAK_MIN_SPEED = 3.0     # a wrist-speed peak counts as a "strike" above this speed
CLOSE_DIST = 1.5         # torsos closer than this (torso lengths) count as "close"
MIN_ARM_SPEED = 0.5      # arm symmetry is only measured when the arms move faster than this
# ---------------------------------------------------

FEATURE_NAMES = [
    # last 1 s
    "max_wrist_speed",     # fastest wrist movement of anyone (torso lengths / s)
    "max_wrist_accel",     # sharpest wrist acceleration of anyone (torso lengths / s^2)
    "min_torso_dist",      # closest the active pair got (torso lengths)
    "closing_speed",       # how fast the active pair's distance shrinks (+ = approaching)
    "max_arm_extension",   # furthest a wrist reaches from its shoulder toward the other person
    # last 2 s
    "wrist_peaks_per_s",   # fast wrist-speed peaks ("strikes") per second, busiest person
    "wrist_toward_speed",  # fastest wrist velocity aimed at the other person's torso
    "pair_motion_energy",  # average all-joint speed of the active pair
    "close_motion",        # all-joint speed of the pair while their torsos are close (hug = low)
    "pair_dist_var",       # variance of the pair's distance (fights move in and out)
]
OLD_FEATURES = list(FEATURE_NAMES)  # the 10 features of the v3 model (for ablations)
FEATURE_NAMES += [
    # all last 2 s, active pair
    "head_dist_min",       # closest the two heads got (torso lengths)
    "head_snap",           # sharpest head acceleration of either person (torso lengths / s^2)
    "facing_score",        # how much the pair face each other (nose vs ears), -1..1
    "ankle_toward_speed",  # fastest ankle velocity aimed at the other person (kicks)
    "knee_lift",           # highest knee relative to its hip (torso lengths; higher = lifted)
    "height_drop",         # largest drop of a person's shoulders (falling or pushed down)
    "arm_asymmetry",       # left vs right wrist speed difference while close (hug ~0, punch ~1)
    "elbow_ext_rate",      # fastest elbow straightening (degrees / s, punch extension)
    "energy_max",          # all-joint motion energy of the more active person
    "energy_min",          # ... and of the less active person (one attacker vs both moving)
    "contact_s",           # seconds the pair spent close (torsos < CLOSE_DIST)
    "contact_count",       # number of separate close contacts
    "box_iou_max",         # largest YOLO box overlap between the pair
    "visible_body_frac",   # share of the 17 keypoints tracked (1 = full body, ~0.5 = upper body only)
]

SIDES = ("l", "r")
JOINTS = [f"{s}_{j}" for j in ("shoulder", "elbow", "wrist", "hip", "knee", "ankle") for s in SIDES]
HEAD_POINTS = ["nose", "l_eye", "r_eye", "l_ear", "r_ear"]  # v2 files only; NaN otherwise


def _points(df, name, min_conf):
    """(N, 2) array of a keypoint, NaN where confidence is too low."""
    xy = df[[f"{name}_x", f"{name}_y"]].to_numpy(dtype=float, copy=True)
    xy[df[f"{name}_conf"].to_numpy() < min_conf] = np.nan
    return xy


def _midpoint(a, b):
    """Midpoint of two keypoints; if one is missing use the other."""
    return np.where(np.isnan(a), b, np.where(np.isnan(b), a, (a + b) / 2))


def _nanmax(values):
    values = [v for v in values if np.isfinite(v)]
    return max(values) if values else np.nan


CROPS = ("waist-up", "chest-up")


def crop_keypoints(kp: pd.DataFrame, level: str) -> pd.DataFrame:
    """Half-body augmentation: pretend the camera only sees the upper body.
    waist-up: hips, knees and ankles removed; box bottom clipped at the hip line.
    chest-up: also everything below the chest line (halfway shoulders -> hips), e.g. low elbows and wrists;
              box bottom clipped at the chest line. Per person and frame, so it follows each body."""
    out = kp.copy()
    sh_y = out[["l_shoulder_y", "r_shoulder_y"]].mean(axis=1)
    hip_y = out[["l_hip_y", "r_hip_y"]].mean(axis=1)
    cut = hip_y if level == "waist-up" else (sh_y + hip_y) / 2
    for s in SIDES:
        for j in ("hip", "knee", "ankle"):
            out[f"{s}_{j}_conf"] = 0.0
    if level == "chest-up":
        for c in [c[:-5] for c in out.columns if c.endswith("_conf") and c != "box_conf"]:
            out.loc[out[f"{c}_y"] > cut, f"{c}_conf"] = 0.0
    if "box_y2" in out:
        out["box_y2"] = np.minimum(out["box_y2"], cut.fillna(out["box_y2"]))
    return out


def resample_window(kp: pd.DataFrame, t_end: float, frame_times=None) -> pd.DataFrame:
    """Rows of the frames nearest a FEATURE_FPS grid over the last LONG_S seconds before t_end.
    frame_times: every pose frame time (live knows empty frames too); default = times in kp."""
    if kp is None or kp.empty:
        return pd.DataFrame()
    ft = np.unique(kp["time_s"].to_numpy() if frame_times is None else np.asarray(frame_times))
    grid = t_end - np.arange(int(round(FEATURE_FPS * LONG_S))) / FEATURE_FPS
    nearest = ft[np.abs(ft[None, :] - grid[:, None]).argmin(axis=1)]  # nearest frame per grid point
    chosen = nearest[np.abs(nearest - grid) <= 0.5 / FEATURE_FPS]     # skip grid points with no frame
    return kp[kp["time_s"].isin(chosen)]


def window_features(kp: pd.DataFrame, t_end: float, frame_times=None) -> dict:
    """Features for the window ending at t_end: resample to FEATURE_FPS, then compute_features."""
    return compute_features(resample_window(kp, t_end, frame_times), t_end)


class _Person:
    """One tracked person inside the window: times, positions and motion, all torso-scaled."""

    def __init__(self, t, joints, centre, scale, box):
        self.t, self.joints, self.centre, self.scale, self.box = t, joints, centre, scale, box
        dt = np.diff(t)
        self.gap_ok = dt <= MAX_GAP_S
        self.dt = dt
        # Wrist velocity per side: (N-1, 2), sample i is between frame i and i+1 (time t[i+1]).
        self.wrist_vel = {}
        for s in SIDES:
            v = np.diff(joints[f"{s}_wrist"], axis=0) / dt[:, None] / scale
            v[~self.gap_ok] = np.nan
            self.wrist_vel[s] = v
        # All-joint motion energy: mean joint speed per step (NaN if no joint seen in both frames).
        speeds = np.stack([np.linalg.norm(np.diff(joints[j], axis=0), axis=1) for j in JOINTS], axis=1)
        speeds = speeds / dt[:, None] / scale
        speeds[~self.gap_ok] = np.nan
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            self.energy = np.where(np.isnan(speeds).all(axis=1), np.nan, np.nanmean(speeds, axis=1))

    def wrist_speeds(self, t_from):
        """All wrist speeds measured at or after t_from."""
        keep = self.t[1:] >= t_from
        return [x for s in SIDES for x in np.linalg.norm(self.wrist_vel[s][keep], axis=1)]

    def wrist_accels(self, t_from):
        out = []
        if len(self.t) < 3:
            return out
        keep = self.t[2:] >= t_from
        dt_mid = (self.t[2:] - self.t[:-2]) / 2
        for s in SIDES:
            acc = np.diff(self.wrist_vel[s], axis=0) / dt_mid[:, None]
            out.extend(np.linalg.norm(acc[keep], axis=1))
        return out

    def peaks(self):
        """Number of fast local maxima in each wrist's speed series."""
        n = 0
        for s in SIDES:
            sp = np.linalg.norm(self.wrist_vel[s], axis=1)
            for i in range(1, len(sp) - 1):
                if sp[i] > PEAK_MIN_SPEED and sp[i] > sp[i - 1] and sp[i] >= sp[i + 1]:
                    n += 1
        return n

    def max_wrist_speed(self):
        return _nanmax(self.wrist_speeds(-np.inf))

    def vel(self, name):
        """Velocity of a joint, (N-1, 2) in torso lengths / s, NaN across long gaps."""
        v = np.diff(self.joints[name], axis=0) / self.dt[:, None] / self.scale
        v[~self.gap_ok] = np.nan
        return v


def _people(win):
    """Build _Person objects for tracked people (person_id >= 0)."""
    joints_all = {j: _points(win, j, MIN_CONF) for j in JOINTS}
    nan2 = np.full((len(win), 2), np.nan)
    for h in HEAD_POINTS:
        joints_all[h] = _points(win, h, MIN_CONF) if f"{h}_x" in win else nan2
    with warnings.catch_warnings():  # rows without any face point are expected
        warnings.simplefilter("ignore", RuntimeWarning)
        joints_all["head"] = np.nanmean(np.stack([joints_all[h] for h in HEAD_POINTS]), axis=0)
    boxes = (win[["box_x1", "box_y1", "box_x2", "box_y2"]].to_numpy(dtype=float) if "box_x1" in win
             else np.full((len(win), 4), np.nan))
    sh_mid = _midpoint(_points(win, "l_shoulder", TORSO_MIN_CONF), _points(win, "r_shoulder", TORSO_MIN_CONF))
    hip_mid = _midpoint(_points(win, "l_hip", TORSO_MIN_CONF), _points(win, "r_hip", TORSO_MIN_CONF))
    torso = np.linalg.norm(sh_mid - hip_mid, axis=1)
    torso[torso < MIN_TORSO_PX] = np.nan
    centre = (sh_mid + hip_mid) / 2

    # No hips (half body): estimate the torso from shoulder width, else from head size.
    def dist(a, b):
        d = np.linalg.norm(_points(win, a, TORSO_MIN_CONF) - _points(win, b, TORSO_MIN_CONF), axis=1)
        return np.where(d > 1, d, np.nan)
    from_shoulders = dist("l_shoulder", "r_shoulder") * SHOULDER_TO_TORSO
    eye_mid = _midpoint(_points(win, "l_eye", TORSO_MIN_CONF), _points(win, "r_eye", TORSO_MIN_CONF))
    eye_nose = np.linalg.norm(eye_mid - _points(win, "nose", TORSO_MIN_CONF), axis=1)
    from_head = dist("l_ear", "r_ear") * EARS_TO_TORSO
    from_head = np.where(np.isfinite(from_head), from_head, dist("l_eye", "r_eye") * EYES_TO_TORSO)
    from_head = np.where(np.isfinite(from_head), from_head,
                         np.where(eye_nose > 1, eye_nose * EYE_NOSE_TO_TORSO, np.nan))
    for est in (from_shoulders, from_head):
        est[est < MIN_TORSO_PX] = np.nan
    # Centre without hips: half an (estimated) torso below the shoulder midpoint.
    est_torso = np.where(np.isfinite(from_shoulders), from_shoulders, from_head)
    below_shoulders = sh_mid + np.stack([np.zeros(len(win)), est_torso / 2], axis=1)
    centre = np.where(np.isfinite(centre).all(axis=1, keepdims=True), centre, below_shoulders)

    # Bounding-box fallback for centre and scale when shoulders / hips are missing.
    if "box_x1" in win:  # v2 files: YOLO's own person box (always present); used for the centre only
        lo = win[["box_x1", "box_y1"]].to_numpy(dtype=float)
        hi = win[["box_x2", "box_y2"]].to_numpy(dtype=float)
        box_centre = (lo + hi) / 2
    else:  # v1 files: box around all keypoints with conf >= TORSO_MIN_CONF
        all_xy = np.stack([_points(win, j, TORSO_MIN_CONF) for j in JOINTS], axis=1)  # (N, 12, 2)
        n_pts = np.isfinite(all_xy[:, :, 0]).sum(axis=1)
        with warnings.catch_warnings():  # all-NaN rows are expected here
            warnings.simplefilter("ignore", RuntimeWarning)
            lo, hi = np.nanmin(all_xy, axis=1), np.nanmax(all_xy, axis=1)
        box_ok = n_pts >= MIN_BBOX_POINTS
        box_centre = np.where(box_ok[:, None], (lo + hi) / 2, np.nan)
    centre = np.where(np.isfinite(centre).all(axis=1, keepdims=True), centre, box_centre)

    t, pid = win["time_s"].to_numpy(dtype=float), win["person_id"].to_numpy()
    people = {}
    for p in np.unique(pid[pid >= 0]):
        idx = np.where(pid == p)[0]
        idx = idx[np.argsort(t[idx], kind="stable")]
        # Best available ruler: measured torso, else shoulder width, else head size (median over frames).
        scale = np.nan
        for est in (torso, from_shoulders, from_head):
            if np.isfinite(est[idx]).any():
                scale = np.nanmedian(est[idx])
                break
        if not np.isfinite(scale) or scale < MIN_TORSO_PX:
            continue
        people[p] = _Person(t[idx], {j: v[idx] for j, v in joints_all.items()}, centre[idx], scale,
                            boxes[idx])
    return people


def _active_pair(people):
    """Pair seen together >= MIN_PAIR_FRAMES times with the fastest wrists. Returns (a, b, common times)."""
    best, best_score = None, -1.0
    ids = list(people)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            common = np.intersect1d(people[a].t, people[b].t)
            if len(common) < MIN_PAIR_FRAMES:
                continue
            score = np.nan_to_num(people[a].max_wrist_speed()) + np.nan_to_num(people[b].max_wrist_speed())
            if score > best_score:
                best, best_score = (people[a], people[b], common), score
    return best


def compute_features(win: pd.DataFrame, t_end: float = None, people: dict = None) -> dict:
    """win: keypoint rows from the last LONG_S seconds. t_end: window end (default: last row time).
    people: _people(win) if the caller already has it (seq_features.window_inputs shares it)."""
    feats = dict.fromkeys(FEATURE_NAMES, np.nan)
    if win is None or win.empty:
        return feats
    if t_end is None:
        t_end = float(win["time_s"].max())
    t_short = t_end - SHORT_S
    people = _people(win) if people is None else people
    if not people:
        return feats

    # ---- Wrist motion of anyone (1 s) and strikes per second (2 s) ----
    feats["max_wrist_speed"] = _nanmax([x for p in people.values() for x in p.wrist_speeds(t_short)])
    feats["max_wrist_accel"] = _nanmax([x for p in people.values() for x in p.wrist_accels(t_short)])
    feats["wrist_peaks_per_s"] = max(p.peaks() for p in people.values()) / LONG_S
    names = JOINTS + HEAD_POINTS
    feats["visible_body_frac"] = float(np.mean([np.isfinite(np.stack([p.joints[n][:, 0] for n in names])).mean()
                                                for p in people.values()]))

    pair = _active_pair(people)
    if pair is None:
        return feats
    a, b, common = pair
    ia, ib = np.searchsorted(a.t, common), np.searchsorted(b.t, common)
    ok = np.isfinite(a.centre[ia]).all(axis=1) & np.isfinite(b.centre[ib]).all(axis=1)
    ia, ib, tc = ia[ok], ib[ok], common[ok]
    if len(tc) == 0:
        return feats
    dist = np.linalg.norm(a.centre[ia] - b.centre[ib], axis=1) / ((a.scale + b.scale) / 2)
    recent = tc >= t_short

    # ---- Pair features, last 1 s ----
    if recent.any():
        feats["min_torso_dist"] = dist[recent].min()
        tr, dr = tc[recent], dist[recent]
        if len(tr) >= 2 and tr.max() - tr.min() >= MIN_PAIR_SPAN_S:
            feats["closing_speed"] = -np.polyfit(tr, dr, 1)[0]  # negative slope = getting closer
        reaches = []
        for k in np.where(recent & (dist <= ARM_PAIR_MAX_DIST))[0]:
            for me, i_me, other, i_other in ((a, ia[k], b, ib[k]), (b, ib[k], a, ia[k])):
                for s in SIDES:
                    sh = me.joints[f"{s}_shoulder"][i_me]
                    wr = me.joints[f"{s}_wrist"][i_me]
                    to_other = other.centre[i_other] - sh
                    norm = np.linalg.norm(to_other)
                    if norm > 0:
                        reaches.append(np.dot(wr - sh, to_other / norm) / me.scale)
        feats["max_arm_extension"] = _nanmax(reaches)

    # ---- Pair features, last 2 s ----
    if len(dist) >= 3:
        feats["pair_dist_var"] = float(np.var(dist))
    toward = []
    for me, i_me, other, i_other in ((a, ia, b, ib), (b, ib, a, ia)):
        for k_me, k_other in zip(i_me, i_other):
            if k_me == 0:
                continue  # velocity needs the previous frame
            for s in SIDES:
                v = me.wrist_vel[s][k_me - 1]
                to_other = other.centre[k_other] - me.joints[f"{s}_wrist"][k_me]
                norm = np.linalg.norm(to_other)
                if norm > 0 and np.isfinite(v).all():
                    toward.append(np.dot(v, to_other / norm))
    feats["wrist_toward_speed"] = _nanmax(toward)

    # Energy step k (frame k-1 -> k) is attributed to frame k.
    def energy_at(person, idx):
        return np.array([person.energy[i - 1] if i > 0 else np.nan for i in idx])
    e = np.concatenate([energy_at(a, ia), energy_at(b, ib)])
    close = np.concatenate([dist < CLOSE_DIST, dist < CLOSE_DIST])
    if np.isfinite(e).any():
        feats["pair_motion_energy"] = float(np.nanmean(e))
    if np.isfinite(e[close]).any():
        feats["close_motion"] = float(np.nanmean(e[close]))

    feats.update(_body_features(a, b, ia, ib, dist))
    return feats


def _angle(p, q, r):
    """Angle at q (degrees) between q->p and q->r, per row."""
    u, w = p - q, r - q
    cos = np.sum(u * w, axis=1) / (np.linalg.norm(u, axis=1) * np.linalg.norm(w, axis=1))
    return np.degrees(np.arccos(np.clip(cos, -1, 1)))


def _toward(me, i_me, other, i_other, joint):
    """Velocities of `joint` aimed at the other person's centre, over common frames."""
    vel, out = me.vel(joint), []
    for k_me, k_other in zip(i_me, i_other):
        if k_me == 0:
            continue  # velocity needs the previous frame
        v = vel[k_me - 1]
        to_other = other.centre[k_other] - me.joints[joint][k_me]
        norm = np.linalg.norm(to_other)
        if norm > 0 and np.isfinite(v).all():
            out.append(np.dot(v, to_other / norm))
    return out


def _body_features(a, b, ia, ib, dist):
    """Head, leg, arm and whole-body features of the active pair over the last LONG_S seconds.
    ia / ib index each person's frames that both are seen in; dist is their torso distance there."""
    f = {}
    scale = (a.scale + b.scale) / 2
    pair = ((a, ia, b, ib), (b, ib, a, ia))
    close = dist < CLOSE_DIST
    with warnings.catch_warnings():  # all-NaN slices are expected (missing joints)
        warnings.simplefilter("ignore", RuntimeWarning)

        # ---- Head ----
        f["head_dist_min"] = np.nanmin(np.linalg.norm(a.joints["head"][ia] - b.joints["head"][ib], axis=1)
                                       / scale)
        snaps = []
        for p in (a, b):
            if len(p.t) >= 3:
                acc = np.diff(p.vel("head"), axis=0) / ((p.t[2:] - p.t[:-2]) / 2)[:, None]
                snaps.extend(np.linalg.norm(acc, axis=1))
        f["head_snap"] = _nanmax(snaps)
        cos = []
        for me, i_me, other, i_other in pair:
            ears = _midpoint(me.joints["l_ear"][i_me], me.joints["r_ear"][i_me])
            face = me.joints["nose"][i_me] - ears
            to_other = other.centre[i_other] - me.joints["head"][i_me]
            cos.append(np.sum(face * to_other, axis=1) /
                       (np.linalg.norm(face, axis=1) * np.linalg.norm(to_other, axis=1)))
        f["facing_score"] = np.nanmean(np.concatenate(cos))

        # ---- Legs ----
        f["ankle_toward_speed"] = _nanmax([x for me, i_me, other, i_other in pair for s in SIDES
                                           for x in _toward(me, i_me, other, i_other, f"{s}_ankle")])
        f["knee_lift"] = _nanmax([np.nanmax((p.joints[f"{s}_hip"][:, 1] - p.joints[f"{s}_knee"][:, 1])
                                            / p.scale) for p in (a, b) for s in SIDES])
        drops = []
        for p in (a, b):
            y = _midpoint(p.joints["l_shoulder"], p.joints["r_shoulder"])[:, 1]
            if np.isfinite(y).sum() >= 2:  # image y grows downward, so a drop = y above its running min
                drops.append(np.nanmax(y - np.fmin.accumulate(np.where(np.isfinite(y), y, np.inf))) / p.scale)
        f["height_drop"] = _nanmax(drops)

        # ---- Arms ----
        asym = []
        for me, i_me, _, _ in pair:
            for k, k_me in enumerate(i_me):
                if not close[k] or k_me == 0:
                    continue
                vl = np.linalg.norm(me.wrist_vel["l"][k_me - 1])
                vr = np.linalg.norm(me.wrist_vel["r"][k_me - 1])
                if np.isfinite(vl) and np.isfinite(vr) and vl + vr > MIN_ARM_SPEED:
                    asym.append(abs(vl - vr) / (vl + vr))
        f["arm_asymmetry"] = float(np.mean(asym)) if asym else np.nan
        rates = []
        for p in (a, b):
            for s in SIDES:
                ang = _angle(p.joints[f"{s}_shoulder"], p.joints[f"{s}_elbow"], p.joints[f"{s}_wrist"])
                r = np.diff(ang) / p.dt
                r[~p.gap_ok] = np.nan
                rates.extend(r)
        f["elbow_ext_rate"] = _nanmax(rates)

        # ---- Whole body ----
        per_person = [np.nanmean([p.energy[i - 1] for i in idx if i > 0]) if (idx > 0).any() else np.nan
                      for p, idx in ((a, ia), (b, ib))]
        if np.isfinite(per_person).any():
            f["energy_max"], f["energy_min"] = np.nanmax(per_person), np.nanmin(per_person)
        f["contact_s"] = close.sum() / FEATURE_FPS
        f["contact_count"] = int(np.sum(np.diff(np.concatenate([[0], close.astype(int)])) == 1))
        ba, bb = a.box[ia], b.box[ib]
        iw = np.clip(np.minimum(ba[:, 2], bb[:, 2]) - np.maximum(ba[:, 0], bb[:, 0]), 0, None)
        ih = np.clip(np.minimum(ba[:, 3], bb[:, 3]) - np.maximum(ba[:, 1], bb[:, 1]), 0, None)
        area = lambda bx: (bx[:, 2] - bx[:, 0]) * (bx[:, 3] - bx[:, 1])
        f["box_iou_max"] = np.nanmax(iw * ih / (area(ba) + area(bb) - iw * ih))
    return {k: (float(v) if np.isfinite(v) else np.nan) for k, v in f.items()}
