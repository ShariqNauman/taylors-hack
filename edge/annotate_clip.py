"""
Draw what the model saw onto a recorded video: skeletons, level and model score, frame by frame,
with the same pose model, scoring, level logic and drawing as the live edge (earlyeye_edge.py).
Used for Incidents recordings that were filmed before the edge recorded annotated clips.

  edge/.venv/bin/python edge/annotate_clip.py IN.mp4 OUT.mp4 [--camera-id CAM-SC-06] [--stride 2]

Video time drives the scoring (not the wall clock), so it runs as fast as the laptop allows.
The video stays on this laptop.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from collections import deque
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import earlyeye_edge as ee  # noqa: E402


def annotate(src: str, out: str, camera_id: str, stride: int = 2, max_w: int = 960, label: str = "") -> dict:
    worker = ee.PredictProcess() if sys.platform == "darwin" else None   # OpenMP clash on macOS
    import cv2
    import pandas as pd

    src, out_p = str(Path(src).resolve()), Path(out).resolve()
    os.chdir(ee.MODEL_DIR)
    sys.path.insert(0, str(ee.MODEL_DIR))
    import live_detector as ld   # noqa: E402
    import predict as pm         # noqa: E402
    from features import window_features   # noqa: E402
    needs_seq = bool(getattr(pm, "NEEDS_SEQUENCE", False))
    if needs_seq:
        from seq_features import window_inputs   # noqa: E402
    predict = worker if worker is not None else pm.predict
    logic = None
    if hasattr(ld, "LOGIC_CONFIG"):
        from guards import LevelLogic   # noqa: E402
        logic = LevelLogic(ld.LOGIC_CONFIG)
    if worker is not None and hasattr(ld, "CLIP_FEATURES"):
        worker.configure({"CLIP_FEATURES": ld.CLIP_FEATURES})
    model, name, device = ee.load_pose(ld, "auto")

    cap = cv2.VideoCapture(src)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    a = SimpleNamespace(camera_id=camera_id, label=label)
    rows, frame_times = deque(), deque()
    next_score, level, score = ld.SHORT_S, "CALM", 0.0
    writer, tmp, size = None, out_p.with_name(f".{out_p.stem}.tmp.mp4"), None
    h264 = True
    stats = {"frames": 0, "max_score": 0.0, "fight_s": 0.0, "tense_s": 0.0, "peak_s": 0.0}
    # What really happened, for Incidents' "How it unfolded": every level change with the video
    # second, the model's score and the people count (same shape as the live edge's timeline).
    timeline: list[dict] = []
    track: list[dict] = []   # every scoring step, for edge/playback_edge.py (no model at play time)
    i = -1
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        i += 1
        if i % stride:
            continue
        t = i / fps
        res = model.track(frame, persist=True, tracker=ld.TRACKER, imgsz=ld.IMGSZ, conf=ld.DET_CONF,
                          device=device, verbose=False)[0]
        h, w = frame.shape[:2]
        rows.extend(ld.to_rows(res, t, w, h))
        frame_times.append(t)
        while rows and rows[0]["time_s"] < t - ld.HISTORY_S:
            rows.popleft()
        while frame_times and frame_times[0] < t - ld.HISTORY_S:
            frame_times.popleft()
        people = []
        if res.keypoints is not None and len(res.boxes) > 0:
            xy, conf = res.keypoints.xy.cpu().numpy(), res.keypoints.conf.cpu().numpy()
            for p in range(len(xy)):
                people.append({"id": p, "kp": [[float(xy[p, k, 0]) / w, float(xy[p, k, 1]) / h,
                                                float(conf[p, k])] for k in ee.COCO_12]})
        if t >= next_score:
            next_score = t + ld.SCORE_EVERY_S
            kp = pd.DataFrame(list(rows))
            if needs_seq:
                feats, seq = window_inputs(kp, t, frame_times)
                raw = predict(feats, seq)
            else:
                feats = window_features(kp, t, frame_times)
                raw = predict(feats)
            if logic is not None:
                level, score, _ = logic.step(t, raw, feats)
            else:
                score, level = float(raw), "FIGHT" if raw >= ld.FIGHT_AT else "TENSE" if raw >= ld.TENSE_AT else "CALM"
            score = float(score)
            track.append({"t": round(t, 2), "level": level.lower(), "score": round(score, 3), "people": people})
        dt = stride / fps
        stats["frames"] += 1
        if score > stats["max_score"]:
            stats["max_score"], stats["peak_s"] = score, round(t, 1)
        lv = {"FIGHT": "fight", "TENSE": "tense"}.get(level, "calm")
        if (timeline and timeline[-1]["level"] != lv) or (not timeline and lv != "calm"):
            timeline.append({"s": round(t, 1), "level": lv, "score": round(score, 2), "people": max(1, len(people))})
        if level == "FIGHT":
            stats["fight_s"] += dt
        elif level == "TENSE":
            stats["tense_s"] += dt
        frame = ee.draw(frame, people, level, score, a)
        if w > max_w:
            frame = cv2.resize(frame, (max_w, int(h * max_w / w) // 2 * 2))
        if writer is None:
            size = (frame.shape[1], frame.shape[0])
            writer = cv2.VideoWriter(str(tmp), cv2.VideoWriter_fourcc(*"avc1"), fps / stride, size)
            if not writer.isOpened():
                h264 = False
                writer = cv2.VideoWriter(str(tmp), cv2.VideoWriter_fourcc(*"mp4v"), fps / stride, size)
        writer.write(frame)
    cap.release()
    if writer is not None:
        writer.release()
    if worker is not None:
        worker.close()
    if not h264 and shutil.which("ffmpeg"):
        conv = out_p.with_name(f".{out_p.stem}.h264.mp4")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp), "-c:v", "libx264", "-pix_fmt", "yuv420p",
                        "-movflags", "+faststart", str(conv)], check=False)
        if conv.exists():
            tmp.unlink(missing_ok=True)
            tmp = conv
    tmp.replace(out_p)
    stats["max_score"] = round(stats["max_score"], 2)
    stats["fight_s"], stats["tense_s"] = round(stats["fight_s"], 1), round(stats["tense_s"], 1)
    stats["timeline"] = timeline
    stats["track"] = track
    stats["fps"] = round(fps / stride, 3)
    return stats


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--camera-id", default="CAM")
    ap.add_argument("--stride", type=int, default=2, help="score every Nth frame (2 = half the frames)")
    ap.add_argument("--label", default="", help='e.g. "SAMPLE CCTV CLIP", drawn like the live edge does')
    ap.add_argument("--track", help="also write every scoring step here (for edge/playback_edge.py)")
    args = ap.parse_args()
    import json
    track_path = Path(args.track).resolve() if args.track else None   # annotate() changes directory
    res = annotate(args.src, args.out, args.camera_id, args.stride, label=args.label)
    if track_path:
        track_path.write_text(json.dumps({"fps": res["fps"], "track": res["track"]}))
    res.pop("track")
    print(json.dumps(res), flush=True)
