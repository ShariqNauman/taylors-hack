"""
extract_keypoints.py - Run YOLO pose + tracking on each video in videos.csv and
save RAW body keypoints (no features) to keypoints/<dataset>/<video>.csv.

One row per tracked person per sampled frame:
  frame, time_s, frame_w, frame_h, person_id, <kp>_x, <kp>_y, <kp>_conf ...
Face keypoints (nose, eyes, ears) are dropped; only the 12 body keypoints are kept.

Resumable: videos that already have a CSV are skipped. Failures go to failed_videos.txt.

Usage:
  python extract_keypoints.py --per-class 200 --limit 10      # quick test
  python extract_keypoints.py --per-class 200                  # 200 fight + 200 non-fight
  python extract_keypoints.py                                  # every video
"""
import argparse
import time
from pathlib import Path

import cv2
import pandas as pd
from tqdm import tqdm
from ultralytics import YOLO

# ---------------- Tunable constants ----------------
VIDEOS_CSV = Path("videos.csv")
OUT_DIR = Path("keypoints")
FAILED_LOG = Path("failed_videos.txt")
DEFAULT_MODEL = "yolo26n-pose.pt"  # downloaded automatically on first run
DEFAULT_IMGSZ = 640
DEFAULT_DEVICE = "cpu"             # no NVIDIA GPU on this laptop
SAMPLE_FPS = 10                    # frames per second fed to YOLO
MAX_SECONDS = 30                   # only process the first N seconds (a few clips are minutes long)
DET_CONF = 0.25                    # min person detection confidence
TRACKER = "bytetrack.yaml"
SUBSET_SEED = 42                   # makes --per-class pick the same videos every run

# COCO keypoint indices. Face (0-4: nose, eyes, ears) is intentionally left out.
KEYPOINTS = {
    "l_shoulder": 5, "r_shoulder": 6, "l_elbow": 7, "r_elbow": 8,
    "l_wrist": 9, "r_wrist": 10, "l_hip": 11, "r_hip": 12,
    "l_knee": 13, "r_knee": 14, "l_ankle": 15, "r_ankle": 16,
}
# ---------------------------------------------------

COLUMNS = ["frame", "time_s", "frame_w", "frame_h", "person_id"] + [
    f"{name}_{v}" for name in KEYPOINTS for v in ("x", "y", "conf")
]


def out_path_for(row) -> Path:
    """keypoints/<dataset>/<video file name without extension>.csv"""
    return OUT_DIR / row["dataset"] / (Path(row["path"]).stem + ".csv")


def extract_video(model, video_path: str, imgsz: int, device: str) -> pd.DataFrame:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError("cannot open video")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    rows, frame_idx, next_t, first = [], 0, 0.0, True
    while True:
        t = frame_idx / fps
        if t > MAX_SECONDS:
            break
        # Only decode frames we actually use; grab() just advances the others.
        if t + 1e-6 < next_t:
            if not cap.grab():
                break
            frame_idx += 1
            continue
        ok, frame = cap.read()
        if not ok:
            break
        next_t += 1.0 / SAMPLE_FPS

        # persist=False on the first frame resets the tracker, so IDs never carry over between videos.
        res = model.track(frame, persist=not first, tracker=TRACKER, imgsz=imgsz,
                          conf=DET_CONF, device=device, verbose=False)[0]
        first = False

        if res.keypoints is not None and len(res.boxes) > 0:
            kp_xy = res.keypoints.xy.cpu().numpy()      # (people, 17, 2) in pixels
            kp_conf = res.keypoints.conf.cpu().numpy()  # (people, 17)
            ids = res.boxes.id.int().tolist() if res.boxes.id is not None else [-1] * len(kp_xy)
            for p, pid in enumerate(ids):
                row = [frame_idx, round(t, 3), w, h, pid]
                for k in KEYPOINTS.values():
                    row += [round(float(kp_xy[p, k, 0]), 1), round(float(kp_xy[p, k, 1]), 1),
                            round(float(kp_conf[p, k]), 3)]
                rows.append(row)
        frame_idx += 1

    cap.release()
    return pd.DataFrame(rows, columns=COLUMNS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--imgsz", type=int, default=DEFAULT_IMGSZ)
    ap.add_argument("--limit", type=int, default=None, help="process at most N videos")
    ap.add_argument("--device", default=DEFAULT_DEVICE, help="cpu, 0 (first GPU), ...")
    ap.add_argument("--per-class", type=int, default=None,
                    help="random N videos per dataset and label (fixed seed)")
    args = ap.parse_args()

    df = pd.read_csv(VIDEOS_CSV)
    if args.per_class:
        # Per dataset and label, so small datasets (e.g. data/own) are always fully included.
        picks = [g.sample(min(args.per_class, len(g)), random_state=SUBSET_SEED)
                 for _, g in df.groupby(["dataset", "label"])]
        df = pd.concat(picks)
    df = df.sample(frac=1, random_state=SUBSET_SEED)  # shuffle so --limit gets both labels
    if args.limit:
        df = df.head(args.limit)

    todo = [r for _, r in df.iterrows() if not out_path_for(r).exists()]
    print(f"{len(df)} videos selected, {len(df) - len(todo)} already done, {len(todo)} to process")
    if not todo:
        return

    model = YOLO(args.model)
    failed, start = 0, time.time()
    for r in tqdm(todo, unit="video"):
        out = out_path_for(r)
        try:
            kp = extract_video(model, r["path"], args.imgsz, args.device)
            out.parent.mkdir(parents=True, exist_ok=True)
            tmp = out.with_suffix(".tmp")
            kp.to_csv(tmp, index=False)   # write then rename, so a crash never leaves a half CSV
            tmp.replace(out)
        except Exception as e:
            failed += 1
            with open(FAILED_LOG, "a") as f:
                f.write(f"{r['path']}\t{e}\n")

    mins = (time.time() - start) / 60
    print(f"Done: {len(todo) - failed} ok, {failed} failed in {mins:.1f} min "
          f"({mins * 60 / len(todo):.1f} s/video)")
    if failed:
        print(f"See {FAILED_LOG}")


if __name__ == "__main__":
    main()
