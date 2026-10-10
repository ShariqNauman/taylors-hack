"""
record_clips.py - Record labelled 5 s webcam clips for training.

Keys (window focused):
  F = fight  -> data/own/violent/fight_<time>.mp4
  H = hug    -> data/own/nonviolent/hug_<time>.mp4
  N = normal -> data/own/nonviolent/normal_<time>.mp4
  Q = quit
Each key starts a short countdown, then records CLIP_S seconds. Overlays are NOT saved in the clip.

Afterwards add them to training:
  python list_videos.py
  python extract_keypoints.py --per-class 300     # extracts only the new clips
  python train.py
"""
import argparse
import time
from datetime import datetime
from pathlib import Path

import cv2

# ---------------- Tunable constants ----------------
OUT_DIR = Path("data/own")
CLIP_S = 5.0                 # clip length
COUNTDOWN_S = 3.0            # time to get into position after pressing a key
CAM_W, CAM_H, CAM_FPS = 640, 480, 30   # same mode as live_detector.py
KINDS = {"f": ("fight", "violent"), "h": ("hug", "nonviolent"), "n": ("normal", "nonviolent")}
KIND_COLORS = {"fight": (0, 0, 220), "hug": (200, 120, 0), "normal": (90, 90, 90)}  # BGR
# ---------------------------------------------------


def count_clips():
    return {kind: len(list((OUT_DIR / folder).glob(f"{kind}_*.mp4"))) for kind, folder in KINDS.values()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", type=int, default=0)
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        raise SystemExit(f"Cannot open camera {args.camera}")
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAM_W)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAM_H)
    cap.set(cv2.CAP_PROP_FPS, CAM_FPS)
    for folder in {f for _, f in KINDS.values()}:
        (OUT_DIR / folder).mkdir(parents=True, exist_ok=True)

    state, kind, t0, writer, path = "idle", None, 0.0, None, None
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        now = time.time()
        h, w = frame.shape[:2]

        if state == "countdown" and now - t0 >= COUNTDOWN_S:
            folder = dict(KINDS.values())[kind]
            path = OUT_DIR / folder / f"{kind}_{datetime.now():%Y%m%d_%H%M%S}.mp4"
            writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), CAM_FPS, (w, h))
            state, t0 = "recording", now
        if state == "recording":
            writer.write(frame)  # raw frame, before any overlay
            if now - t0 >= CLIP_S:
                writer.release()
                print(f"Saved {path}")
                state = "idle"

        # ---- Overlay (display only) ----
        view = frame.copy()
        if state == "countdown":
            cv2.putText(view, f"{kind.upper()} in {COUNTDOWN_S - (now - t0):.1f}", (20, h // 2),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.5, KIND_COLORS[kind], 4)
        elif state == "recording":
            cv2.rectangle(view, (0, 0), (w, 45), KIND_COLORS[kind], -1)
            cv2.circle(view, (25, 22), 10, (255, 255, 255), -1)
            cv2.putText(view, f"REC {kind.upper()}  {CLIP_S - (now - t0):.1f} s", (45, 32),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)
        else:
            cv2.putText(view, "F = fight   H = hug   N = normal   Q = quit", (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        counts = count_clips() if state == "idle" else None
        if counts:
            cv2.putText(view, "  ".join(f"{k}: {v}" for k, v in counts.items()), (10, h - 15),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        cv2.imshow("EarlyEye - record clips", view)

        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), ord("Q")):
            break
        if state == "idle" and chr(key).lower() in KINDS:
            kind, state, t0 = KINDS[chr(key).lower()][0], "countdown", now

    if writer is not None and state == "recording":
        writer.release()
        path.unlink(missing_ok=True)  # don't keep a half clip
        print(f"Discarded unfinished {path}")
    cap.release()
    cv2.destroyAllWindows()
    print("Clips so far:", count_clips())


if __name__ == "__main__":
    main()
