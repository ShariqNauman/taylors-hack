"""
edge_server.py - High-Performance EarlyEye Edge Server on GraphiLab NVIDIA RTX 5090.

Features:
- Full CUDA acceleration with NVIDIA GeForce RTX 5090 (250+ FPS pose estimation)
- Standard EarlyEye API Contract:
    GET  /health       -> {"ok": true, "camera_id": "CAM-AU-01", "gpu": "RTX 5090", ...}
    GET  /stream.mjpg  -> Live MJPEG stream with skeletons drawn
    GET  /live.json    -> Live telemetry, levels, scores, keypoints
    POST /frame        -> Live webcam frame ingest from local laptop; returns detected skeletons
- Dual-Source: Seamless fallback to campus demo clips when webcam is inactive
- Full 17-Keypoint Skeleton Overlay (Head, Arms, Torso, Legs) for reliable desk & standing tracking
- Automatic alert dispatch to Render backend (https://earl-eye-backend.onrender.com/events)
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import cv2
import numpy as np
import pandas as pd
from ultralytics import YOLO

import features
import predict as predict_module
from features import window_features
from predict import predict

predict_module.MODE = "lgbm"

MYT = timezone(timedelta(hours=8))

# Full 17 COCO keypoints: 0:nose, 1:l_eye, 2:r_eye, 3:l_ear, 4:r_ear,
# 5:l_sho, 6:r_sho, 7:l_elb, 8:r_elb, 9:l_wri, 10:r_wri,
# 11:l_hip, 12:r_hip, 13:l_knee, 14:r_knee, 15:l_ank, 16:r_ank
COCO_12 = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]

ALL_BONES = [
    # Head & Face (crucial for webcam / sitting view)
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
    (0, 165, 255),    # Orange
]
LEVEL_BGR = {"CALM": (122, 178, 63), "TENSE": (35, 179, 245), "FIGHT": (79, 90, 255)}
STREAM_FPS = 25
CLOSE_AFTER_CALM_S = 3.0


def iso_now() -> str:
    return datetime.now(MYT).isoformat(timespec="seconds")


class State:
    def __init__(self, args):
        self.args = args
        self.lock = threading.Lock()
        self.running = True
        self.frame = None
        self.frame_id = 0
        self.jpeg = None
        self.people = []
        self.people_17 = []
        self.level = "CALM"
        self.score = 0.0
        self.feats = {}
        self.updated_at = iso_now()
        self.incident = None
        self.calm_since = None
        self.posted = set()
        self.post_log = deque(maxlen=20)
        self.last_live_frame = 0.0
        self.live_active = False


def reason_from(feats: dict, level: str, people: int) -> str:
    def f(name):
        v = feats.get(name)
        return None if v is None or (isinstance(v, float) and math.isnan(v)) else float(v)

    pme, close, wrist, dist = f("pair_motion_energy"), f("close_motion"), f("max_wrist_speed"), f("min_torso_dist")
    if level == "FIGHT":
        if close is not None and close > 0.6:
            return "Fast whole-body motion while close, held for over 1 s."
        if wrist is not None and wrist > 3:
            return "Repeated fast arm motion toward the other person, held for over 1 s."
        return "High physical tension score held for over 1 s."
    if people >= 5:
        return f"{people} people close together; motion rising."
    if dist is not None and dist < 0.8:
        return "Pair moving closer; body motion rising."
    if pme is not None and pme > 0.4:
        return "Body motion of the pair rising."
    if wrist is not None and wrist > 2:
        return "Wrist speed rising."
    return "Physical tension above the alert threshold."


def top_features(feats: dict, score: float) -> list[dict]:
    out = []
    for name in ("close_motion", "pair_motion_energy", "max_wrist_speed"):
        v = feats.get(name)
        if v is not None and not (isinstance(v, float) and math.isnan(v)):
            out.append({"name": name, "value": round(float(v), 2)})
    out.append({"name": "risk_score", "value": round(float(score), 2)})
    return out


def priority(level: str, score: float, risk: float, people: int) -> float:
    sev = {"tense": 0.4, "fight_likely": 0.8, "fight": 1.0}.get(level, 0.1)
    return round(min(1.0, sev * score * risk * min(1.0, 0.6 + people * 0.1)), 2)


def tick_incident(s: State, now: float):
    a = s.args
    level = s.level
    people = max(1, len(s.people))
    snap = {"t": iso_now(), "people": s.people}
    inc = s.incident

    if level == "CALM":
        if inc is None:
            return
        s.calm_since = s.calm_since or now
        if now - s.calm_since >= CLOSE_AFTER_CALM_S:
            inc["end_time"] = iso_now()
            post_event(s, inc, final=True)
            s.incident, s.calm_since = None, None
        return

    s.calm_since = None
    lv = "fight" if level == "FIGHT" else "tense"
    if inc is None:
        inc = s.incident = {
            "incident_id": f"INC-{datetime.now(MYT):%Y}-{random.randint(10000, 99999)}",
            "camera_id": a.camera_id,
            "location": a.location,
            "zone_type": a.zone,
            "start_time": iso_now(),
            "end_time": None,
            "type": "crowd" if people >= 5 else "fight",
            "level": lv,
            "peak_score": 0.0,
            "eta_seconds": None,
            "priority": 0.0,
            "reason": "",
            "people_count": people,
            "action": "",
            "nearest_staff": a.staff,
            "status": "new",
            "staff_note": None,
        }

    if inc["level"] != "fight":
        inc["level"] = lv
    inc["people_count"] = people
    inc["reason"] = reason_from(s.feats, level, people)
    inc["action"] = f"Dispatch {a.staff} immediately" if inc["level"] == "fight" else "Monitor feed"
    if s.score >= inc["peak_score"]:
        inc["peak_score"] = round(float(s.score), 2)
        inc["peak_snapshot"] = snap
    inc["priority"] = max(inc["priority"], priority(inc["level"], s.score, a.zone_risk, people))
    inc["snapshot"] = snap
    inc["top_features"] = top_features(s.feats, s.score)
    post_event(s, inc)


def post_event(s: State, inc: dict, final: bool = False):
    a = s.args
    if a.no_post or not a.api:
        return
    if inc["level"] != "fight" or inc["incident_id"] in s.posted:
        return
    body = {k: v for k, v in inc.items() if k not in ("pushed_to", "pushed_at", "acked_at")}
    s.posted.add(inc["incident_id"])
    threading.Thread(target=_post, args=(s, a.api.rstrip("/") + "/events", body), daemon=True).start()


def _post(s: State, url: str, body: dict):
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            msg = f"POST {body['incident_id']} {body['level']} -> {r.status}"
    except urllib.error.HTTPError as e:
        msg = f"POST {body['incident_id']} {body['level']} -> HTTP {e.code}"
    except Exception as e:
        msg = f"POST {body['incident_id']} failed: {e}"
    s.post_log.append(msg)
    print(f"[{iso_now()}] {msg}", flush=True)


def draw(frame, people_17, level, score, a, is_live: bool):
    """Draws full 17-keypoint body skeletons and HUD."""
    h, w = frame.shape[:2]

    for i, p in enumerate(people_17):
        col = PERSON_BGR[i % len(PERSON_BGR)]
        pts = {}
        for k, (x, y, conf) in enumerate(p["kp"]):
            if conf >= 0.25:
                pts[k] = (int(x * w), int(y * h))

        # Draw bones
        for u, v in ALL_BONES:
            if u in pts and v in pts:
                cv2.line(frame, pts[u], pts[v], col, 3, cv2.LINE_AA)

        # Draw joints
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

    # Bottom HUD Bar
    cv2.rectangle(frame, (0, h - 34), (w, h), (18, 22, 28), -1)
    badge = "● LIVE WEBCAM" if is_live else "● CAMPUS DEMO"
    badge_col = (50, 205, 50) if is_live else (200, 200, 200)
    cv2.putText(frame, badge, (10, h - 11), cv2.FONT_HERSHEY_SIMPLEX, 0.5, badge_col, 2, cv2.LINE_AA)
    cv2.putText(frame, f"{a.camera_id} | RTX 5090 GPU", (160, h - 11), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (180, 180, 180), 1, cv2.LINE_AA)

    level_col = LEVEL_BGR.get(level, (255, 255, 255))
    cv2.putText(frame, f"{level} ({score:.2f})", (w - 180, h - 11), cv2.FONT_HERSHEY_SIMPLEX, 0.55, level_col, 2, cv2.LINE_AA)
    return frame


KEYPOINTS_NAMES = [
    "nose", "l_eye", "r_eye", "l_ear", "r_ear",
    "l_shoulder", "r_shoulder", "l_elbow", "r_elbow", "l_wrist", "r_wrist",
    "l_hip", "r_hip", "l_knee", "r_knee", "l_ankle", "r_ankle"
]


def to_rows(res, t: float, w: int, h: int) -> list[dict]:
    rows = []
    if res.keypoints is None or len(res.boxes) == 0:
        return rows
    xy, conf = res.keypoints.xy.cpu().numpy(), res.keypoints.conf.cpu().numpy()
    boxes = res.boxes.xyxy.cpu().numpy()
    box_conf = res.boxes.conf.cpu().numpy()
    ids = res.boxes.id.int().tolist() if res.boxes.id is not None else [-1] * len(xy)
    for p, pid in enumerate(ids):
        x1, y1, x2, y2 = boxes[p]
        row = {
            "time_s": t,
            "frame_w": w,
            "frame_h": h,
            "person_id": int(pid),
            "box_x1": float(x1),
            "box_y1": float(y1),
            "box_x2": float(x2),
            "box_y2": float(y2),
            "box_conf": float(box_conf[p]),
        }
        for k, name in enumerate(KEYPOINTS_NAMES):
            row[f"{name}_x"] = float(xy[p, k, 0])
            row[f"{name}_y"] = float(xy[p, k, 1])
            row[f"{name}_conf"] = float(conf[p, k])
        rows.append(row)
    return rows


def run_pipeline(s: State):
    os.chdir("/root/earlyeye")
    sys.path.insert(0, "/root/earlyeye")
    a = s.args
    print(f"Loading YOLO26n-pose model on CUDA:0 (RTX 5090)...", flush=True)
    model = YOLO("/root/earlyeye/yolo26n-pose.pt")
    dummy = np.zeros((480, 640, 3), dtype=np.uint8)
    model.predict(dummy, imgsz=640, device=0, verbose=False)
    print(f"YOLO26n-pose initialized successfully on RTX 5090!", flush=True)

    fallback_cap = None
    if a.fallback_video and Path(a.fallback_video).exists():
        fallback_cap = cv2.VideoCapture(str(a.fallback_video))
        print(f"Fallback campus video loaded: {a.fallback_video}", flush=True)

    rows, frame_times = deque(), deque()
    last_id = 0
    next_score = 0.5
    smooth = 0.0
    high_since = None
    fight_until = -1.0
    start = time.time()

    while s.running:
        now = time.time()
        t = now - start

        # Check if live webcam frame is active (within last 3.5s)
        is_live = (now - s.last_live_frame) < 3.5
        with s.lock:
            s.live_active = is_live

        current_frame = None
        if is_live:
            with s.lock:
                if s.frame_id != last_id:
                    current_frame = s.frame.copy() if s.frame is not None else None
                    last_id = s.frame_id
        else:
            if fallback_cap is not None and fallback_cap.isOpened():
                ret, f = fallback_cap.read()
                if not ret:
                    fallback_cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    ret, f = fallback_cap.read()
                if ret:
                    current_frame = f
                time.sleep(1.0 / 30.0)
            else:
                f = np.zeros((480, 640, 3), dtype=np.uint8)
                cv2.putText(f, "EARLYEYE EDGE ONLINE (RTX 5090)", (80, 220), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (0, 255, 200), 2, cv2.LINE_AA)
                cv2.putText(f, "Ready for laptop webcam feed...", (140, 260), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (180, 180, 180), 1, cv2.LINE_AA)
                current_frame = f
                time.sleep(1.0 / 15.0)

        if current_frame is None:
            time.sleep(0.005)
            continue

        h, w = current_frame.shape[:2]
        res = model.track(
            current_frame,
            persist=True,
            tracker="/root/earlyeye/bytetrack_v2.yaml",
            imgsz=640,
            conf=0.25,
            device=0,
            verbose=False,
        )[0]

        rows.extend(to_rows(res, t, w, h))
        frame_times.append(t)
        while rows and rows[0]["time_s"] < t - 3.0:
            rows.popleft()
        while frame_times and frame_times[0] < t - 3.0:
            frame_times.popleft()

        people_12 = []
        people_17 = []
        if res.keypoints is not None and len(res.boxes) > 0:
            xy = res.keypoints.xy.cpu().numpy()
            conf = res.keypoints.conf.cpu().numpy()
            ids = res.boxes.id.int().tolist() if res.boxes.id is not None else list(range(len(xy)))
            for p, pid in enumerate(ids):
                # 12-keypoints contract for API
                kp12 = [
                    [round(float(xy[p, k, 0]) / w, 4),
                     round(float(xy[p, k, 1]) / h, 4),
                     round(float(conf[p, k]), 2)]
                    for k in COCO_12
                ]
                people_12.append({"id": int(pid), "kp": kp12})

                # All 17 keypoints for full visual rendering
                kp17 = [
                    [round(float(xy[p, k, 0]) / w, 4),
                     round(float(xy[p, k, 1]) / h, 4),
                     round(float(conf[p, k]), 2)]
                    for k in range(17)
                ]
                people_17.append({"id": int(pid), "kp": kp17})

        annotated = draw(current_frame.copy(), people_17, s.level, s.score, a, is_live)
        ok, jpg = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 75])
        with s.lock:
            s.people = people_12
            s.people_17 = people_17
            if ok:
                s.jpeg = jpg.tobytes()

        # Score window every 0.5 s
        if t >= next_score and len(rows) > 0:
            next_score = t + 0.5
            try:
                df = pd.DataFrame(list(rows))
                feats = window_features(df, t, frame_times)
                raw = predict(feats)
                smooth = 0.6 * raw + 0.4 * smooth
            except Exception as e:
                print(f"[scoring error]: {e}", flush=True)
                feats = {}

            high_since = (high_since if high_since is not None else t) if smooth >= 0.55 else None
            if high_since is not None and t - high_since >= 1.0:
                fight_until = t + 2.0
            level = "FIGHT" if t <= fight_until else "TENSE" if smooth >= 0.385 else "CALM"

            with s.lock:
                s.level, s.score, s.feats, s.updated_at = level, float(smooth), feats, iso_now()
                tick_incident(s, time.time())

    if fallback_cap:
        fallback_cap.release()


def make_handler(s: State):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _cors(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Allow-Headers", "*")
            self.send_header("Cache-Control", "no-store")

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.end_headers()

        def _json(self, obj, code=200):
            data = json.dumps(obj).encode()
            self.send_response(code)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            path = self.path.split("?")[0]
            if path == "/frame":
                try:
                    content_length = int(self.headers.get("Content-Length", 0))
                    body = self.rfile.read(content_length)
                    arr = np.frombuffer(body, np.uint8)
                    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                    if img is not None:
                        with s.lock:
                            s.frame = img
                            s.frame_id += 1
                            s.last_live_frame = time.time()
                            cur_people = list(s.people_17)
                            cur_level = s.level
                            cur_score = round(s.score, 2)
                        return self._json({
                            "ok": True,
                            "frame_id": s.frame_id,
                            "level": cur_level,
                            "score": cur_score,
                            "people": cur_people,
                        })
                    return self._json({"error": "invalid image"}, 400)
                except Exception as e:
                    return self._json({"error": str(e)}, 500)
            return self._json({"error": "not found"}, 404)

        def do_GET(self):
            path = self.path.split("?")[0]
            a = s.args
            if path == "/health":
                with s.lock:
                    live = s.live_active
                return self._json({
                    "ok": True,
                    "camera_id": a.camera_id,
                    "source": "live" if live else "recorded",
                    "gpu": "NVIDIA GeForce RTX 5090",
                    "live_webcam_active": live,
                })

            if path == "/live.json":
                with s.lock:
                    inc = dict(s.incident) if s.incident else None
                    body = {
                        "camera_id": a.camera_id,
                        "source": "live" if s.live_active else "recorded",
                        "gpu": "NVIDIA GeForce RTX 5090",
                        "level": s.level.lower(),
                        "score": round(s.score, 3),
                        "people_count": len(s.people),
                        "updated_at": s.updated_at,
                        "snapshot": {"t": s.updated_at, "people": s.people},
                        "incident": inc,
                        "posts": list(s.post_log)[-5:],
                    }
                return self._json(body)

            if path == "/stream.mjpg":
                self.send_response(200)
                self._cors()
                self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
                self.end_headers()
                try:
                    while s.running:
                        with s.lock:
                            jpg = s.jpeg
                        if jpg:
                            self.wfile.write(
                                b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                                + str(len(jpg)).encode() + b"\r\n\r\n" + jpg + b"\r\n"
                            )
                        time.sleep(1.0 / STREAM_FPS)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return None

            return self._json({"error": "not found"}, 404)

    return H


def main():
    os.chdir("/root/earlyeye")
    sys.path.insert(0, "/root/earlyeye")
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera-id", default="CAM-AU-01")
    ap.add_argument("--location", default="Grand Hall")
    ap.add_argument("--zone", default="auditorium")
    ap.add_argument("--zone-risk", type=float, default=0.5)
    ap.add_argument("--staff", default="Guard B")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--api", default="https://earl-eye-backend.onrender.com")
    ap.add_argument("--fallback-video", default="/root/earlyeye/data/recorded_data/violence/WIN_20261010_19_59_33_Pro.mp4")
    ap.add_argument("--no-post", action="store_true")
    args = ap.parse_args()

    s = State(args)
    srv = ThreadingHTTPServer((args.host, args.port), make_handler(s))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    print(f"GraphiLab EarlyEye Server running on http://{args.host}:{args.port}", flush=True)
    print(f"Alerts will be pushed to {args.api}/events", flush=True)

    try:
        run_pipeline(s)
    except KeyboardInterrupt:
        pass
    finally:
        s.running = False
        srv.shutdown()


if __name__ == "__main__":
    main()
