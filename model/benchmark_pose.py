"""
benchmark_pose.py - Pose fps for PyTorch vs OpenVINO (CPU / Intel GPU) at several IMGSZ,
on real 640x480 frames (same size as the webcam). Exports OpenVINO models if missing.

Usage:  python benchmark_pose.py
"""
import time

import cv2
from ultralytics import YOLO

import live_detector as ld

# ---------------- Tunable constants ----------------
VIDEO = "data/Violence/V_71.mp4"   # any clip with people in it
IMGSZ_LIST = [320, 480, 640]
BACKENDS = [("PyTorch", "cpu"), ("OpenVINO", "cpu"), ("OpenVINO", "intel:gpu")]
WARMUP, RUNS = 5, 40
# ---------------------------------------------------


def main():
    cap = cv2.VideoCapture(VIDEO)
    frames = []
    while len(frames) < RUNS:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(cv2.resize(f, (640, 480)))
    print(f"{len(frames)} frames at 640x480 from {VIDEO}\n")

    for backend, device in BACKENDS:
        for imgsz in IMGSZ_LIST:
            try:
                if backend == "PyTorch":
                    model = YOLO(ld.MODEL_PT)
                else:
                    ld.IMGSZ = imgsz
                    model, _, _ = ld.load_pose_model(imgsz)
                for f in frames[:WARMUP]:
                    model.track(f, persist=True, imgsz=imgsz, device=device, verbose=False)
                start = time.time()
                for f in frames:
                    model.track(f, persist=True, imgsz=imgsz, device=device, verbose=False)
                fps = len(frames) / (time.time() - start)
                print(f"{backend:8} {device:9} imgsz {imgsz}: {fps:5.1f} pose fps")
            except Exception as e:
                print(f"{backend:8} {device:9} imgsz {imgsz}: failed ({str(e).splitlines()[0][:80]})")


if __name__ == "__main__":
    main()
