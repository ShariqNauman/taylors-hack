"""
extract_keypoints_v2.py - High-quality keypoint extraction (v2). Runs YOLO pose + ByteTrack on each
video in videos.csv and saves RAW detections to keypoints_v2/<same folders as data/>/<video>.csv.

Differences from v1 (extract_keypoints.py, kept for the old files in keypoints/):
  - every frame at the video's native fps (capped at MAX_FPS), with the frame's own timestamp
  - all 17 COCO keypoints, face included
  - each person's bounding box (x1, y1, x2, y2) and box confidence
  - ByteTrack with a longer track buffer (bytetrack_v2.yaml) to reduce ID switches
  - OpenVINO on the Intel GPU when available (falls back to OpenVINO CPU, then PyTorch CPU)

One row per tracked person per frame:
  frame, time_s, src_fps, frame_w, frame_h, person_id, box_x1, box_y1, box_x2, box_y2, box_conf,
  <kp>_x, <kp>_y, <kp>_conf for the 17 keypoints
Frames with nobody in them get no rows; features resample to their own FEATURE_FPS anyway.

Resumable: videos that already have a CSV are skipped. Failures go to failed_videos_v2.txt.

Usage:
  python extract_keypoints_v2.py --per-class 300 --limit 10           # quick test
  python extract_keypoints_v2.py --per-class 300                       # 300 per dataset and label
  python extract_keypoints_v2.py --model yolo26s-pose.pt               # other pose model
"""
import argparse
import time
from pathlib import Path

import cv2
import numpy as np
import pandas as pd
from tqdm import tqdm
from ultralytics import YOLO

# ---------------- Tunable constants ----------------
VIDEOS_CSV = Path("videos.csv")
OUT_DIR = Path("keypoints_v2")
FAILED_LOG = Path("failed_videos_v2.txt")
DEFAULT_MODEL = "yolo26n-pose.pt"  # downloaded automatically on first run
IMGSZ = 640
DEVICE = "intel:gpu"               # OpenVINO device; falls back to OpenVINO cpu, then PyTorch cpu
USE_OPENVINO = True
MAX_FPS = 30                       # videos above this are subsampled to MAX_FPS
MAX_SECONDS = 30                   # only process the first N seconds (a few clips are minutes long)
OWN_DATASETS = {"OwnRec"}          # our own phone / webcam videos: full length, and each frame's own
                                   # timestamp (phones and webcams record at a variable frame rate)
DET_CONF = 0.25                    # min person detection confidence
TRACKER = "bytetrack_v2.yaml"      # ByteTrack with track_buffer 60 (frames)
SUBSET_SEED = 42                   # makes --per-class pick the same videos every run

# All 17 COCO keypoints, in COCO index order.
KEYPOINTS = ["nose", "l_eye", "r_eye", "l_ear", "r_ear",
             "l_shoulder", "r_shoulder", "l_elbow", "r_elbow", "l_wrist", "r_wrist",
             "l_hip", "r_hip", "l_knee", "r_knee", "l_ankle", "r_ankle"]
# ---------------------------------------------------

COLUMNS = (["frame", "time_s", "src_fps", "frame_w", "frame_h", "person_id",
            "box_x1", "box_y1", "box_x2", "box_y2", "box_conf"]
           + [f"{name}_{v}" for name in KEYPOINTS for v in ("x", "y", "conf")])


def load_pose_model(model_pt=DEFAULT_MODEL, imgsz=IMGSZ, device=DEVICE):
    """OpenVINO export of the pose model on `device`, falling back to OpenVINO cpu, then PyTorch cpu.
    Returns (model, device, backend name). An NVIDIA device ("0", "cuda:0") uses plain PyTorch on CUDA."""
    if str(device).isdigit() or str(device).startswith("cuda"):
        return YOLO(model_pt), device, f"PyTorch {device}"
    if USE_OPENVINO:
        ov_dir = Path(f"{Path(model_pt).stem}_{imgsz}_openvino_model")  # name must end in _openvino_model
        try:
            if not ov_dir.exists():
                print(f"Exporting {model_pt} to OpenVINO at imgsz {imgsz} (one time only)...")
                Path(YOLO(model_pt).export(format="openvino", imgsz=imgsz)).rename(ov_dir)
            for dev in dict.fromkeys([device, "cpu"]):
                try:
                    model = YOLO(str(ov_dir), task="pose")
                    model.predict(np.zeros((480, 640, 3), np.uint8), imgsz=imgsz, device=dev, verbose=False)
                    return model, dev, f"OpenVINO {dev}"
                except Exception as e:
                    print(f"OpenVINO on {dev} failed ({str(e).splitlines()[0]})")
        except Exception as e:
            print(f"OpenVINO not available ({e}), using PyTorch")
    return YOLO(model_pt), "cpu", "PyTorch cpu"


def result_rows(res, frame_idx, t, fps, w, h):
    """YOLO result -> one row per person in COLUMNS order."""
    if res.keypoints is None or len(res.boxes) == 0:
        return []
    kp_xy = res.keypoints.xy.cpu().numpy()       # (people, 17, 2) in pixels
    kp_conf = res.keypoints.conf.cpu().numpy()   # (people, 17)
    boxes = res.boxes.xyxy.cpu().numpy()         # (people, 4) in pixels
    box_conf = res.boxes.conf.cpu().numpy()
    ids = res.boxes.id.int().tolist() if res.boxes.id is not None else [-1] * len(kp_xy)
    rows = []
    for p, pid in enumerate(ids):
        row = [frame_idx, round(t, 4), round(fps, 3), w, h, pid,
               *[round(float(v), 1) for v in boxes[p]], round(float(box_conf[p]), 3)]
        for k in range(len(KEYPOINTS)):
            row += [round(float(kp_xy[p, k, 0]), 1), round(float(kp_xy[p, k, 1]), 1),
                    round(float(kp_conf[p, k]), 3)]
        rows.append(row)
    return rows


def extract_video(model, video_path, device, imgsz=IMGSZ, max_seconds=MAX_SECONDS, use_pts=False):
    """Returns (DataFrame of rows, number of frames run through the model).
    use_pts: time = the frame's own timestamp (variable frame rate) instead of frame / fps."""
    if use_pts:
        return _extract_pts(model, video_path, device, imgsz, max_seconds)
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError("cannot open video")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    rows, frame_idx, n_used, next_t = [], 0, 0, 0.0
    while True:
        t = frame_idx / fps  # exact time of this frame (constant frame rate)
        if max_seconds is not None and t > max_seconds:
            break
        # Above MAX_FPS: only decode the frames we use; grab() just advances the others.
        if fps > MAX_FPS and t + 1e-6 < next_t:
            if not cap.grab():
                break
            frame_idx += 1
            continue
        ok, frame = cap.read()
        if not ok:
            break
        next_t += 1.0 / MAX_FPS

        # persist=False on the first frame resets the tracker, so IDs never carry over between videos.
        res = model.track(frame, persist=n_used > 0, tracker=TRACKER, imgsz=imgsz,
                          conf=DET_CONF, device=device, verbose=False)[0]
        rows += result_rows(res, frame_idx, t, fps, w, h)
        n_used += 1
        frame_idx += 1

    cap.release()
    return pd.DataFrame(rows, columns=COLUMNS), n_used


def _extract_pts(model, video_path, device, imgsz, max_seconds):
    """Variable frame rate: grab every frame, read its timestamp, keep at most MAX_FPS per second."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError("cannot open video")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    rows, frame_idx, n_used, next_t, t0 = [], -1, 0, 0.0, None
    while cap.grab():
        frame_idx += 1
        pts = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        t0 = pts if t0 is None else t0
        t = pts - t0                                  # first frame = 0 s
        if max_seconds is not None and t > max_seconds:
            break
        if t + 1e-6 < next_t:                         # above MAX_FPS: skip this frame
            continue
        ok, frame = cap.retrieve()
        if not ok:
            break
        next_t = t + 1.0 / MAX_FPS
        res = model.track(frame, persist=n_used > 0, tracker=TRACKER, imgsz=imgsz,
                          conf=DET_CONF, device=device, verbose=False)[0]
        rows += result_rows(res, frame_idx, t, fps, w, h)
        n_used += 1
    cap.release()
    return pd.DataFrame(rows, columns=COLUMNS), n_used


def out_path_for(row) -> Path:
    """keypoints_v2/<path inside data/>.csv, e.g. data/AIRTLab/non-violent/cam1/3.mp4 ->
    keypoints_v2/AIRTLab/non-violent/cam1/3.csv. Mirrors the folders because file names repeat
    (AIRTLab has 1.mp4 in every folder)."""
    rel = Path(row["path"]).relative_to("data")
    return OUT_DIR / rel.with_suffix(".csv")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--limit", type=int, default=None, help="process at most N videos")
    ap.add_argument("--per-class", type=int, default=None,
                    help="random N videos per dataset and label (fixed seed)")
    ap.add_argument("--datasets", nargs="*", default=None, help="only these datasets, e.g. RLVS SCF")
    ap.add_argument("--device", default=DEVICE, help="intel:gpu / cpu (OpenVINO) or 0 / cuda:0 (NVIDIA)")
    ap.add_argument("--shard", default=None,
                    help="i/n: only every n-th video starting at i, so n processes can run side by side")
    args = ap.parse_args()

    df = pd.read_csv(VIDEOS_CSV)
    if args.datasets:
        df = df[df["dataset"].isin(args.datasets)]
    if args.per_class:
        # Per dataset and label, so small datasets are always fully included.
        picks = [g.sample(min(args.per_class, len(g)), random_state=SUBSET_SEED)
                 for _, g in df.groupby(["dataset", "label"])]
        df = pd.concat(picks)
    df = df.sample(frac=1, random_state=SUBSET_SEED)  # shuffle so --limit gets both labels
    if args.limit:
        df = df.head(args.limit)
    if args.shard:
        i, n = map(int, args.shard.split("/"))
        df = df.iloc[i::n]

    todo = [r for _, r in df.iterrows() if not out_path_for(r).exists()]
    print(f"{len(df)} videos selected, {len(df) - len(todo)} already done, {len(todo)} to process")
    if not todo:
        return

    model, device, backend = load_pose_model(args.model, device=args.device)
    print(f"Pose: {args.model} on {backend}, imgsz {IMGSZ}, tracker {TRACKER}")
    failed, frames, start = 0, 0, time.time()
    for r in tqdm(todo, unit="video"):
        out = out_path_for(r)
        try:
            own = r["dataset"] in OWN_DATASETS
            kp, n = extract_video(model, r["path"], device, max_seconds=None if own else MAX_SECONDS, use_pts=own)
            frames += n
            out.parent.mkdir(parents=True, exist_ok=True)
            tmp = out.with_suffix(".tmp")
            kp.to_csv(tmp, index=False)   # write then rename, so a crash never leaves a half CSV
            tmp.replace(out)
        except Exception as e:
            failed += 1
            with open(FAILED_LOG, "a") as f:
                f.write(f"{r['path']}\t{e}\n")

    secs = time.time() - start
    print(f"Done: {len(todo) - failed} ok, {failed} failed in {secs / 60:.1f} min "
          f"({frames / max(secs, 1e-6):.1f} frames/s)")
    if failed:
        print(f"See {FAILED_LOG}")


if __name__ == "__main__":
    main()
