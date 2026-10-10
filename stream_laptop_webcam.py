"""
stream_laptop_webcam.py - Live Webcam Streamer for EarlyEye on GraphiLab RTX 5090

Features:
- Natural Mirror View (fixes inverted webcam)
- Real-Time Skeleton Overlay rendered right in your local window
- Streams frames to GraphiLab RTX 5090 for pose tracking & tension scoring
- Press 'q' to stop

Usage:
  python stream_laptop_webcam.py
  python stream_laptop_webcam.py --camera 0
  python stream_laptop_webcam.py --no-flip     # if your camera is already mirrored
"""
import argparse
import json
import math
import sys
import threading
import time
import requests
import cv2

DEFAULT_GPU_URL = "https://graphs-calls-event-absent.trycloudflare.com"

ALL_BONES = [
    # Head & Face
    (0, 1), (0, 2), (1, 3), (2, 4), (0, 5), (0, 6),
    # Shoulders & Arms
    (5, 6), (5, 7), (7, 9), (6, 8), (8, 10),
    # Torso
    (5, 11), (6, 12), (11, 12),
    # Legs
    (11, 13), (13, 15), (12, 14), (14, 16)
]

PERSON_BGR = [
    (255, 224, 0),    # Bright Cyan/Yellow
    (255, 50, 200),   # Bright Magenta
    (0, 255, 128),    # Bright Mint Green
]
LEVEL_BGR = {"CALM": (122, 178, 63), "TENSE": (35, 179, 245), "FIGHT": (79, 90, 255)}


def draw_skeletons(frame, people, level, score):
    h, w = frame.shape[:2]
    for i, p in enumerate(people):
        col = PERSON_BGR[i % len(PERSON_BGR)]
        pts = {}
        for k, (x, y, conf) in enumerate(p.get("kp", [])):
            if conf >= 0.25:
                pts[k] = (int(x * w), int(y * h))

        # Bones
        for u, v in ALL_BONES:
            if u in pts and v in pts:
                cv2.line(frame, pts[u], pts[v], col, 3, cv2.LINE_AA)

        # Joint Circles
        for pt in pts.values():
            cv2.circle(frame, pt, 4, (255, 255, 255), -1, cv2.LINE_AA)
            cv2.circle(frame, pt, 2, col, -1, cv2.LINE_AA)

        # Prominent Head Tracking Circle & Neck
        face_pts = [pts[k] for k in range(5) if k in pts]
        head_pos = None
        if face_pts:
            hx = int(sum(p[0] for p in face_pts) / len(face_pts))
            hy = int(sum(p[1] for p in face_pts) / len(face_pts))
            head_pos = (hx, hy)
        elif 5 in pts and 6 in pts:
            sho_mid_x = (pts[5][0] + pts[6][0]) // 2
            sho_mid_y = (pts[5][1] + pts[6][1]) // 2
            sho_dist = int(math.hypot(pts[5][0] - pts[6][0], pts[5][1] - pts[6][1]))
            head_pos = (sho_mid_x, max(15, sho_mid_y - int(sho_dist * 0.55)))

        if head_pos:
            hr = 22
            if 5 in pts and 6 in pts:
                sho_dist = int(math.hypot(pts[5][0] - pts[6][0], pts[5][1] - pts[6][1]))
                hr = max(16, int(sho_dist * 0.25))
            cv2.circle(frame, head_pos, hr, col, 2, cv2.LINE_AA)
            cv2.circle(frame, head_pos, 5, (255, 255, 255), -1, cv2.LINE_AA)
            cv2.circle(frame, head_pos, 3, col, -1, cv2.LINE_AA)
            if 5 in pts and 6 in pts:
                neck = ((pts[5][0] + pts[6][0]) // 2, (pts[5][1] + pts[6][1]) // 2)
                cv2.line(frame, neck, head_pos, col, 3, cv2.LINE_AA)

    # HUD Bar
    cv2.rectangle(frame, (0, h - 34), (w, h), (18, 22, 28), -1)
    cv2.putText(frame, "● LIVE WEBCAM", (10, h - 11), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (50, 205, 50), 2, cv2.LINE_AA)
    cv2.putText(frame, "RTX 5090 GPU Active", (160, h - 11), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (180, 180, 180), 1, cv2.LINE_AA)

    lvl_col = LEVEL_BGR.get(level, (255, 255, 255))
    cv2.putText(frame, f"{level} ({score:.2f})", (w - 180, h - 11), cv2.FONT_HERSHEY_SIMPLEX, 0.55, lvl_col, 2, cv2.LINE_AA)
    return frame


def main():
    parser = argparse.ArgumentParser(description="Stream laptop webcam to GraphiLab GPU")
    parser.add_argument("--url", default=DEFAULT_GPU_URL, help="GraphiLab Edge URL")
    parser.add_argument("--camera", default=0, type=int, help="Camera index (default: 0)")
    parser.add_argument("--fps", default=25, type=int, help="Target streaming FPS")
    parser.add_argument("--no-flip", action="store_true", help="Do not flip horizontally (mirror mode)")
    parser.add_argument("--no-preview", action="store_true", help="Run headlessly without OpenCV window")
    args = parser.parse_args()

    target_url = args.url.rstrip("/") + "/frame"
    print("=" * 60)
    print("EarlyEye Live Webcam Streamer -> GraphiLab RTX 5090")
    print(f"Target GPU Endpoint: {target_url}")
    print(f"Mirror Mode: {'OFF' if args.no_flip else 'ON (Natural Selfie View)'}")
    print(f"Opening Camera {args.camera}...")
    print("=" * 60)

    # DirectShow for Windows
    if sys.platform == "win32":
        cap = cv2.VideoCapture(args.camera, cv2.CAP_DSHOW)
        if not cap.isOpened():
            cap = cv2.VideoCapture(args.camera)
    else:
        cap = cv2.VideoCapture(args.camera)

    if not cap.isOpened():
        print(f"[ERROR] Could not open camera {args.camera}!")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    cap.set(cv2.CAP_PROP_FPS, args.fps)

    print("Camera active. Streaming frames and receiving RTX 5090 skeletons...")
    print("Press 'q' in the window to stop.")

    running = True
    frame_count = 0
    t0 = time.time()
    last_status = "Connecting..."

    lock = threading.Lock()
    latest_jpg = [None]
    current_people = []
    current_level = "CALM"
    current_score = 0.0

    session = requests.Session()
    session.headers.update({"Content-Type": "image/jpeg"})

    def post_worker():
        nonlocal last_status, current_people, current_level, current_score
        while running:
            jpg_data = None
            with lock:
                if latest_jpg[0] is not None:
                    jpg_data = latest_jpg[0]
                    latest_jpg[0] = None

            if jpg_data is not None:
                try:
                    r = session.post(target_url, data=jpg_data, timeout=2.0)
                    if r.status_code == 200:
                        data = r.json()
                        with lock:
                            current_people = data.get("people", [])
                            current_level = data.get("level", "CALM")
                            current_score = data.get("score", 0.0)
                        last_status = "RTX 5090: Skeletons Active"
                except Exception as e:
                    last_status = f"Network: {e}"
            else:
                time.sleep(0.005)

    sender_thread = threading.Thread(target=post_worker, daemon=True)
    sender_thread.start()

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                time.sleep(0.01)
                continue

            frame_count += 1

            # Natural Mirror View (Flip Horizontally) unless user disables it
            if not args.no_flip:
                frame = cv2.flip(frame, 1)

            # High-speed upload: 480x360 @ quality 55 (~15 KB vs 75 KB) for 4x faster transmission
            upload_frame = cv2.resize(frame, (480, 360), interpolation=cv2.INTER_AREA)
            ok, jpg = cv2.imencode(".jpg", upload_frame, [cv2.IMWRITE_JPEG_QUALITY, 55])
            if ok:
                with lock:
                    latest_jpg[0] = jpg.tobytes()

            if not args.no_preview:
                preview = frame.copy()
                with lock:
                    ppl = list(current_people)
                    lvl = current_level
                    sc = current_score

                # Draw RTX 5090 Skeletons directly on preview!
                preview = draw_skeletons(preview, ppl, lvl, sc)

                fps = frame_count / max(0.001, time.time() - t0)
                cv2.putText(
                    preview,
                    f"{fps:.1f} FPS | {last_status}",
                    (10, 25),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    (255, 255, 255),
                    1,
                    cv2.LINE_AA,
                )

                cv2.imshow("EarlyEye Camera Streamer -> GraphiLab", preview)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break

            time.sleep(1.0 / args.fps)

    except KeyboardInterrupt:
        pass
    finally:
        running = False
        cap.release()
        if not args.no_preview:
            cv2.destroyAllWindows()
        print("\nStream stopped.")


if __name__ == "__main__":
    main()
