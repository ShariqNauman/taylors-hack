"""
live_detector.py - Live fight detection from a webcam (or a video file for testing).

Three threads so the video stays smooth:
  capture thread: reads camera frames (640x480 @ 30 fps)
  pose thread:    YOLO pose + tracking on the newest frame, then every 0.5 s:
                  features.window_features (last 2 s resampled to FEATURE_FPS, same as training)
                  -> predict.py
                  -> smoothed risk -> CALM / TENSE / FIGHT, logged to live_features.csv
  main thread:    draws the newest frame + skeletons + HUD

Labelling while recording (for tune_live.py): hold F during a staged fight, H during a hug,
N (or nothing) = normal. The current label is always shown top-right, changes are printed in the
terminal, and the label is saved with every window. Press q to quit.

Usage:
  python live_detector.py                      # default webcam
  python live_detector.py --camera 1           # another webcam
  python live_detector.py --camera data/Violence/V_71.mp4   # test on a video file (plays in real time)
"""
import argparse
import csv
import threading
import time
from collections import Counter, deque
from pathlib import Path

import cv2
import numpy as np
import pandas as pd
from ultralytics import YOLO

import predict as predict_module
from features import FEATURE_NAMES, SHORT_S, window_features
from predict import predict
from extract_keypoints_v2 import KEYPOINTS as EXTRACT_KEYPOINTS
from seq_features import window_inputs

# ---------------- Tunable constants ----------------
MODEL_PT = "yolo26n-pose.pt"
USE_OPENVINO = True      # export once to OpenVINO (much faster on Intel CPUs), fall back to PyTorch
IMGSZ = 640              # pose input size: 320 / 480 / 640. 640 = same as training extraction
DEVICE = "intel:gpu"       # Intel iGPU via OpenVINO (65 pose fps at 640 vs 29 on CPU); falls back to cpu
DET_CONF = 0.25
TRACKER = "bytetrack_v2.yaml"   # same as extract_keypoints_v2.py (track buffer 60)
CAM_W, CAM_H, CAM_FPS = 640, 480, 30   # requested webcam mode
SCORE_EVERY_S = 0.5      # score a new window every 0.5 s (features use the last LONG_S = 2 s)
HISTORY_S = 3.0          # how much pose history to keep for resampling
SMOOTH_ALPHA = 0.6       # exponential smoothing: higher = reacts faster, lower = steadier
# FIGHT_AT per scoring mode (predict.MODE), each fixed on the training part (out-of-fold) so that 9% of
# normal clips reach FIGHT. Hold-out result for the ensemble: 78.5% of fights, 11.0% of normal clips,
# 11.1% of AIRTLab hugs/claps, 68.4% of weapon clips reach FIGHT (REPORT.md Part A0).
# Not yet tuned on our own webcam footage: record a labelled session, then tune_live.py.
TENSE_AT = 0.5          # smoothed score >= this -> TENSE
FIGHT_AT = 0.658        # ensemble: smoothed score >= this ...
FIGHT_AT_LGBM = 0.695   # used instead when predict.MODE == "lgbm"
MIN_DURATION = 1.0       # ... for at least this many seconds -> FIGHT
FIGHT_HOLD = 2.0         # keep showing FIGHT this many seconds after it triggers
LOG_CSV = "live_features.csv"
MIN_DRAW_CONF = 0.5      # only draw keypoints at least this confident
LABEL_KEYS = {"F": "fight", "H": "hug", "N": "normal"}  # hold key -> label; nothing held = normal
LABEL_COLORS = {"fight": (0, 0, 220), "hug": (200, 120, 0), "normal": (90, 90, 90)}  # BGR
KEY_HOLD_TIMEOUT = 0.6   # non-Windows fallback: key counts as held this long after its last repeat

# All 17 COCO keypoints, same as extract_keypoints_v2.py: the head features and the sequence model need
# the face points (used only as head position). Only the 12 body points are drawn.
KEYPOINTS = {name: i for i, name in enumerate(EXTRACT_KEYPOINTS)}
BODY_POINTS = [KEYPOINTS[n] for n in KEYPOINTS if n not in ("nose", "l_eye", "r_eye", "l_ear", "r_ear")]
BONES = [(5, 7), (7, 9), (6, 8), (8, 10), (5, 6), (5, 11), (6, 12), (11, 12),
         (11, 13), (13, 15), (12, 14), (14, 16)]
ACTIVE_FIGHT_AT = FIGHT_AT_LGBM if predict_module.MODE == "lgbm" else FIGHT_AT
LEVEL_COLORS = {"CALM": (0, 180, 0), "TENSE": (0, 200, 255), "FIGHT": (0, 0, 255)}  # BGR
# ---------------------------------------------------

try:  # Windows: read whether a key is physically held down right now
    import ctypes
    _user32 = ctypes.windll.user32
except (ImportError, AttributeError):
    _user32 = None


class Shared:
    """State passed between the threads. Frames are replaced, never edited, so a short lock is enough."""
    def __init__(self):
        self.lock = threading.Lock()
        self.running = True
        self.start = time.time()
        self.frame, self.frame_t, self.frame_id = None, 0.0, 0
        self.pose = None                       # (xy, conf) of the newest pose result, for drawing
        self.score, self.level = 0.0, "CALM"
        self.pose_fps, self.display_fps = 0.0, 0.0
        self.labels = deque()                  # (time, label) samples from the keyboard
        self.kp_writer = None                  # csv.DictWriter for --save-keypoints (pose thread only)

    def now(self):
        return time.time() - self.start


def load_pose_model(imgsz):
    """OpenVINO export of the pose model (one folder per imgsz) on DEVICE, falling back to
    OpenVINO on CPU, then plain PyTorch. Returns (model, name for the HUD, device)."""
    if USE_OPENVINO:
        ov_dir = Path(f"{Path(MODEL_PT).stem}_{imgsz}_openvino_model")  # name must end in _openvino_model
        try:
            if not ov_dir.exists():
                print(f"Exporting {MODEL_PT} to OpenVINO at imgsz {imgsz} (one time only)...")
                Path(YOLO(MODEL_PT).export(format="openvino", imgsz=imgsz)).rename(ov_dir)
            for device in dict.fromkeys([DEVICE, "cpu"]):
                try:
                    model = YOLO(str(ov_dir), task="pose")
                    model.predict(np.zeros((CAM_H, CAM_W, 3), np.uint8), imgsz=imgsz,
                                  device=device, verbose=False)  # test the device works
                    return model, f"OpenVINO {device} {imgsz}", device
                except Exception as e:
                    print(f"OpenVINO on {device} failed ({str(e).splitlines()[0]})")
        except Exception as e:
            print(f"OpenVINO not available ({e}), using PyTorch")
    return YOLO(MODEL_PT), f"PyTorch cpu {imgsz}", "cpu"


def to_rows(res, t, w, h):
    """YOLO result -> rows in the same format as the keypoint CSVs."""
    rows = []
    if res.keypoints is None or len(res.boxes) == 0:
        return rows
    xy, conf = res.keypoints.xy.cpu().numpy(), res.keypoints.conf.cpu().numpy()
    boxes, box_conf = res.boxes.xyxy.cpu().numpy(), res.boxes.conf.cpu().numpy()
    ids = res.boxes.id.int().tolist() if res.boxes.id is not None else [-1] * len(xy)
    for p, pid in enumerate(ids):
        x1, y1, x2, y2 = boxes[p]
        row = {"time_s": t, "frame_w": w, "frame_h": h, "person_id": pid,
               "box_x1": x1, "box_y1": y1, "box_x2": x2, "box_y2": y2, "box_conf": box_conf[p]}
        for name, k in KEYPOINTS.items():
            row[f"{name}_x"], row[f"{name}_y"], row[f"{name}_conf"] = xy[p, k, 0], xy[p, k, 1], conf[p, k]
        rows.append(row)
    return rows


def window_label(s, t):
    """Most common keyboard label during the last SHORT_S (1 s)."""
    with s.lock:
        recent = [lb for ts, lb in s.labels if ts > t - SHORT_S]
    return Counter(recent).most_common(1)[0][0] if recent else "normal"


def capture_loop(cap, s, is_file, file_fps):
    n = 0
    while s.running:
        ok, frame = cap.read()
        if not ok:
            break
        n += 1
        if is_file:  # play files at real speed so the threads behave like a live camera
            time.sleep(max(0.0, n / file_fps - s.now()))
        with s.lock:
            s.frame, s.frame_t, s.frame_id = frame, s.now(), n
    s.running = False


def pose_loop(model, device, s, log):
    rows, frame_times = deque(), deque()  # pose history (rows per person, and every pose frame time)
    last_id, next_score, last_tick = 0, SHORT_S, time.time()
    smooth, high_since, fight_until = 0.0, None, -1.0
    while s.running:
        with s.lock:
            frame, t, fid = s.frame, s.frame_t, s.frame_id
        if frame is None or fid == last_id:
            time.sleep(0.002)
            continue
        last_id = fid
        res = model.track(frame, persist=True, tracker=TRACKER, imgsz=IMGSZ, conf=DET_CONF,
                          device=device, verbose=False)[0]
        h, w = frame.shape[:2]
        new_rows = to_rows(res, t, w, h)
        rows.extend(new_rows)
        if s.kp_writer is not None:  # raw keypoints + the key held now, for training on our own footage
            with s.lock:
                label = s.labels[-1][1] if s.labels else "normal"
            for r in new_rows:
                s.kp_writer.writerow({**r, "label": label})
        frame_times.append(t)
        while rows and rows[0]["time_s"] < t - HISTORY_S:
            rows.popleft()
        while frame_times and frame_times[0] < t - HISTORY_S:
            frame_times.popleft()

        now = time.time()
        pose = None
        if res.keypoints is not None and len(res.boxes) > 0:
            pose = (res.keypoints.xy.cpu().numpy(), res.keypoints.conf.cpu().numpy())
        with s.lock:
            s.pose = pose
            s.pose_fps = 0.9 * s.pose_fps + 0.1 / max(now - last_tick, 1e-6)
        last_tick = now

        if t < next_score:
            continue
        next_score = t + SCORE_EVERY_S
        kp = pd.DataFrame(list(rows))
        if predict_module.NEEDS_SEQUENCE:  # one shared people-finding pass for both models
            feats, seq = window_inputs(kp, t, frame_times)
        else:
            feats, seq = window_features(kp, t, frame_times), None
        raw = predict(feats, seq)
        smooth = SMOOTH_ALPHA * raw + (1 - SMOOTH_ALPHA) * smooth
        high_since = (high_since if high_since is not None else t) if smooth >= ACTIVE_FIGHT_AT else None
        if high_since is not None and t - high_since >= MIN_DURATION:
            fight_until = t + FIGHT_HOLD
        level = "FIGHT" if t <= fight_until else "TENSE" if smooth >= TENSE_AT else "CALM"
        with s.lock:
            s.score, s.level = smooth, level
        log.writerow([round(t, 2), *[round(feats[f], 3) for f in FEATURE_NAMES],
                      round(raw, 3), round(smooth, 3), level, window_label(s, t)])


def draw_skeletons(frame, pose):
    if pose is None:
        return
    xy, conf = pose
    for p in range(len(xy)):
        pts = {k: tuple(map(int, xy[p, k])) for k in BODY_POINTS if conf[p, k] >= MIN_DRAW_CONF}
        for a, b in BONES:
            if a in pts and b in pts:
                cv2.line(frame, pts[a], pts[b], (255, 200, 0), 2)
        for pt in pts.values():
            cv2.circle(frame, pt, 3, (255, 255, 255), -1)


def draw_hud(frame, s, label, model_name):
    h, w = frame.shape[:2]
    color = LEVEL_COLORS[s.level]
    top = 10
    if s.level == "FIGHT":  # red banner across the top
        cv2.rectangle(frame, (0, 0), (w, 50), (0, 0, 255), -1)
        cv2.putText(frame, "FIGHT DETECTED", (10, 36), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (255, 255, 255), 3)
        top = 60
    cv2.putText(frame, f"display {s.display_fps:4.1f} fps | pose {s.pose_fps:4.1f} fps | {model_name}",
                (10, top + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    # Recording label, always visible: filled box top-right + key hint.
    cv2.rectangle(frame, (w - 190, top + 28), (w - 10, top + 68), LABEL_COLORS[label], -1)
    cv2.putText(frame, f"LABEL: {label.upper()}", (w - 182, top + 56),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
    cv2.putText(frame, "hold F=fight H=hug N=normal", (w - 230, top + 86),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
    # Risk bar along the bottom with the two threshold marks.
    x0, x1, y0, y1 = 10, w - 10, h - 30, h - 10
    cv2.rectangle(frame, (x0, y0), (x1, y1), (60, 60, 60), -1)
    cv2.rectangle(frame, (x0, y0), (x0 + int((x1 - x0) * s.score), y1), color, -1)
    for th in (TENSE_AT, ACTIVE_FIGHT_AT):
        x = x0 + int((x1 - x0) * th)
        cv2.line(frame, (x, y0 - 4), (x, y1 + 4), (255, 255, 255), 1)
    cv2.putText(frame, f"{s.level}  risk {s.score:.2f}", (10, h - 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)


def held_label(key, last):
    """Label from the keys held right now. last = [label, time] for the non-Windows fallback."""
    if _user32 is not None:
        for k, name in LABEL_KEYS.items():
            if _user32.GetAsyncKeyState(ord(k)) & 0x8000:
                return name
        return "normal"
    for k, name in LABEL_KEYS.items():  # fallback: key repeats while held
        if key in (ord(k), ord(k.lower())):
            last[:] = [name, time.time()]
    return last[0] if time.time() - last[1] < KEY_HOLD_TIMEOUT else "normal"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", default="0", help="webcam index or a video file path")
    ap.add_argument("--no-show", action="store_true", help="don't open a window (for testing)")
    ap.add_argument("--log", default=LOG_CSV, help="where to write the per-window log")
    ap.add_argument("--seconds", type=float, default=None, help="stop after this many seconds (speed tests)")
    ap.add_argument("--save-keypoints", default=None, metavar="CSV",
                    help="also save every tracked person per frame (17 keypoints + box + held label), so the "
                         "session can be added to training")
    args = ap.parse_args()

    source = int(args.camera) if args.camera.isdigit() else args.camera
    is_file = not isinstance(source, int)
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise SystemExit(f"Cannot open camera/video: {args.camera}")
    if not is_file:
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAM_W)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAM_H)
        cap.set(cv2.CAP_PROP_FPS, CAM_FPS)
    file_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    print(f"Source: {int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))}x{int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))}"
          f" @ {file_fps:.0f} fps")

    model, model_name, device = load_pose_model(IMGSZ)
    log_file = open(args.log, "w", newline="")
    log = csv.writer(log_file)
    log.writerow(["time_s", *FEATURE_NAMES, "raw_score", "smoothed_score", "level", "label"])

    s = Shared()
    kp_file = None
    if args.save_keypoints:
        kp_file = open(args.save_keypoints, "w", newline="")
        cols = (["time_s", "frame_w", "frame_h", "person_id", "box_x1", "box_y1", "box_x2", "box_y2", "box_conf"]
                + [f"{n}_{v}" for n in KEYPOINTS for v in ("x", "y", "conf")] + ["label"])
        s.kp_writer = csv.DictWriter(kp_file, fieldnames=cols)
        s.kp_writer.writeheader()
    threads = [threading.Thread(target=capture_loop, args=(cap, s, is_file, file_fps), daemon=True),
               threading.Thread(target=pose_loop, args=(model, device, s, log), daemon=True)]
    for th in threads:
        th.start()

    shown_id, last_tick, last_key, n_shown, pose_fps_seen = 0, time.time(), ["normal", 0.0], 0, []
    prev_label = "normal"
    while s.running:
        if args.seconds and s.now() > args.seconds:
            break
        if args.no_show:
            time.sleep(0.05)
            pose_fps_seen.append(s.pose_fps)
            continue
        with s.lock:
            frame, fid, pose = s.frame, s.frame_id, s.pose
        if frame is None or fid == shown_id:
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
            continue
        shown_id = fid
        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        label = held_label(key, last_key)
        if label != prev_label:  # confirm in the terminal that the key registered
            print(f"[{s.now():6.1f} s] label -> {label.upper()}")
            prev_label = label
        with s.lock:
            s.labels.append((s.now(), label))
            while s.labels and s.labels[0][0] < s.now() - HISTORY_S:
                s.labels.popleft()

        frame = frame.copy()  # the pose thread may still be reading the original
        draw_skeletons(frame, pose)
        draw_hud(frame, s, label, model_name)
        cv2.imshow("EarlyEye", frame)
        now = time.time()
        s.display_fps = 0.9 * s.display_fps + 0.1 / max(now - last_tick, 1e-6)
        last_tick = now
        n_shown += 1
        pose_fps_seen.append(s.pose_fps)

    s.running = False
    for th in threads:
        th.join(timeout=2)
    cap.release()
    log_file.close()
    if kp_file:
        kp_file.close()
        print(f"Saved raw keypoints to {args.save_keypoints}")
    cv2.destroyAllWindows()
    run_s = s.now()
    pose_fps = np.median(pose_fps_seen[len(pose_fps_seen) // 4:]) if pose_fps_seen else 0
    print(f"{model_name}: display {n_shown / run_s:.1f} fps, pose ~{pose_fps:.1f} fps over {run_s:.0f} s. "
          f"Logged scored windows to {args.log}")
    log_df = pd.read_csv(args.log)
    if len(log_df):  # quick check that labels were captured, and what the detector did per label
        print("\nWindows per label and level:")
        print(pd.crosstab(log_df["label"], log_df["level"]).to_string())


if __name__ == "__main__":
    main()
