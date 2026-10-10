"""
earlyeye_edge.py - the bridge between the live model and the dashboard.

Runs the same pipeline as model/live_detector.py (YOLO26n-pose + ByteTrack -> 17 keypoints + boxes
-> seq_features.window_inputs over the last 2 s (LightGBM features + CNN sequence) -> predict.py ->
guards.LevelLogic: CALM / TENSE / FIGHT with the same preset, thresholds, guards and single-person
rule as live_detector.py), and adds what the dashboard needs:

  GET  /health       {ok, camera_id, source}            dashboard's on-site probe (800 ms)
  GET  /stream.mjpg  MJPEG, skeletons drawn, ~10 fps    on-site video, never leaves the laptop
  GET  /live.json    current level, score, people, open incident with snapshot + top_features
  POST <API>/events  the event record (docs/kayla-frontend-plan.md contract) to the Render API

Video never leaves this laptop. Only the event JSON (keypoints, no pixels) goes to the API.

Usage (from the repo root, Python 3.11, model/requirements.txt installed):
  python edge/earlyeye_edge.py                                   # webcam 0 as CAM-AU-01, Grand Hall
  python edge/earlyeye_edge.py --camera clip.mp4 --loop --source recorded \
      --camera-id CAM-BC-03 --location "Block C stairwell" --zone stairwell --zone-risk 0.8 --port 8766
  python edge/earlyeye_edge.py --fake                            # scripted escalation, no camera/model
  python edge/earlyeye_edge.py --no-post                         # serve the dashboard, post nothing

API posting:
  --upsert   post every 0.5 s under one incident_id and close it with end_time (needs the API's
             POST /events to upsert, docs/work-split.md B5).
  default    the API on main inserts only, so post once per incident, at the first FIGHT. Tense stays
             on this laptop's dashboard (/live.json), which is the two-tier rule anyway.
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

REPO = Path(__file__).resolve().parents[1]
CLIPS = Path(__file__).resolve().parent / "clips"  # <incident_id>.mp4, kept on this laptop, never uploaded
MODEL_DIR = REPO / "model"
MYT = timezone(timedelta(hours=8))

# 12 body keypoints in contract order (COCO 5-16): l_sho, r_sho, l_elb, r_elb, l_wri, r_wri,
# l_hip, r_hip, l_knee, r_knee, l_ank, r_ank.
COCO_12 = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
DRAW_BONES = [(5, 7), (7, 9), (6, 8), (8, 10), (5, 6), (5, 11), (6, 12), (11, 12),
              (11, 13), (13, 15), (12, 14), (14, 16)]
PERSON_BGR = [(255, 224, 127), (255, 167, 201), (214, 206, 201)]  # cyan, violet, grey (BGR)
LEVEL_BGR = {"CALM": (122, 178, 63), "TENSE": (35, 179, 245), "FIGHT": (79, 90, 255)}
CLOSE_AFTER_CALM_S = 3.0      # an incident ends after this long back at CALM
STREAM_FPS = 10


def iso_now() -> str:
    return datetime.now(MYT).isoformat(timespec="seconds")


# ------------------------------------------------------------------ shared state
class State:
    def __init__(self, args):
        self.args = args
        self.lock = threading.Lock()
        self.running = True
        self.frame = None            # newest BGR frame
        self.frame_id = 0
        self.jpeg = None             # newest annotated JPEG for /stream.mjpg
        self.people = []             # [{id, kp: [[x,y,conf] x12]}] normalised 0-1
        self.level = "CALM"
        self.score = 0.0
        self.feats: dict = {}
        self.blocked: list = []      # guards that blocked an alarm-level score in the last window
        self.updated_at = iso_now()
        self.incident: dict | None = None
        self.calm_since: float | None = None
        self.posted: set[str] = set()
        self.post_log = deque(maxlen=20)


# ------------------------------------------------------------------ incident logic
def reason_from(feats: dict, level: str, people: int) -> str:
    """One plain sentence from the strongest signals (the model's top features)."""
    def f(name):
        v = feats.get(name)
        return None if v is None or (isinstance(v, float) and math.isnan(v)) else float(v)
    pme, close, wrist, dist = f("pair_motion_energy"), f("close_motion"), f("max_wrist_speed"), f("min_torso_dist")
    if level == "FIGHT":
        if close is not None and close > 0.6:
            return "Fast whole-body motion while close, held for over 1 s."
        if wrist is not None and wrist > 3:
            return "Repeated fast arm motion toward the other person, held for over 1 s."
        return "High risk score held for over 1 s."
    if people >= 5:
        return f"{people} people close together; motion rising."
    if dist is not None and dist < 0.8:
        return "Pair moving closer; body motion rising."
    if pme is not None and pme > 0.4:
        return "Body motion of the pair rising."
    if wrist is not None and wrist > 2:
        return "Wrist speed rising."
    return "Risk score above the tense line."


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
    """Called after every scored window (0.5 s). Opens, updates and closes the incident."""
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
            "camera_id": a.camera_id, "location": a.location, "zone_type": a.zone,
            "start_time": iso_now(), "end_time": None,
            "type": "crowd" if people >= 5 else "fight", "level": lv,
            "peak_score": 0.0, "eta_seconds": None, "priority": 0.0, "reason": "",
            "people_count": people, "action": "", "nearest_staff": a.staff,
            "status": "new", "staff_note": None,
        }
    # Level never steps down inside an open incident until it closes (FIGHT_HOLD covers dips).
    if inc["level"] != "fight":
        inc["level"] = lv
    inc["people_count"] = people
    inc["reason"] = reason_from(s.feats, level, people)
    inc["action"] = f"Send {a.staff} now; call the security lead" if inc["level"] == "fight" else "Watch this camera"
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
    if not a.upsert:
        # Insert-only API: one record per incident, at the first fight (the alarm moment).
        if inc["level"] != "fight" or inc["incident_id"] in s.posted:
            return
    body = {k: v for k, v in inc.items() if k not in ("pushed_to", "pushed_at", "acked_at")}
    s.posted.add(inc["incident_id"])
    threading.Thread(target=_post, args=(s, a.api.rstrip("/") + "/events", body), daemon=True).start()


def _post(s: State, url: str, body: dict):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            msg = f"POST {body['incident_id']} {body['level']} -> {r.status}"
    except urllib.error.HTTPError as e:
        msg = f"POST {body['incident_id']} {body['level']} -> HTTP {e.code} {e.read()[:160]!r}"
    except Exception as e:  # network down: the on-site dashboard still works from /live.json
        msg = f"POST {body['incident_id']} failed: {e}"
    s.post_log.append(msg)
    print(msg, flush=True)


# ------------------------------------------------------------------ prediction worker
def _predict_worker(conn, model_dir: str):
    """LightGBM in its own process. On macOS, PyTorch and LightGBM ship different OpenMP
    runtimes and segfault when both load in one process, so the score runs here."""
    os.chdir(model_dir)
    sys.path.insert(0, model_dir)
    from predict import predict  # noqa: E402  (model/predict.py)
    while True:
        try:
            msg = conn.recv()
        except (EOFError, KeyboardInterrupt):
            return
        if msg is None:
            return
        try:
            feats, seq = msg
            conn.send(float(predict(feats, seq)))
        except Exception as e:  # report, keep serving
            conn.send(("error", str(e)))


class PredictProcess:
    def __init__(self):
        import multiprocessing as mp
        ctx = mp.get_context("spawn")
        self.conn, child = ctx.Pipe()
        self.proc = ctx.Process(target=_predict_worker, args=(child, str(MODEL_DIR)), daemon=True)
        self.proc.start()

    def __call__(self, feats: dict, seq=None) -> float:
        self.conn.send((feats, seq))
        out = self.conn.recv()
        if isinstance(out, tuple):
            raise RuntimeError(out[1])
        return out

    def close(self):
        try:
            self.conn.send(None)
        except Exception:
            pass


# ------------------------------------------------------------------ real pipeline
def run_model(s: State):
    """Capture + pose + scoring with the model team's code and thresholds (read-only import)."""
    import cv2
    import numpy as np
    import pandas as pd

    a = s.args
    # macOS: score in a separate process (OpenMP clash between torch and LightGBM). Start it
    # before torch loads. Windows/Linux keep the model team's in-process path.
    worker = PredictProcess() if sys.platform == "darwin" else None
    # Resolve a video path against where the user ran the command, before moving into model/.
    src = int(a.camera) if str(a.camera).isdigit() else str(Path(a.camera).expanduser().resolve())
    os.chdir(MODEL_DIR)                      # model code uses relative paths (joblib, tracker yaml)
    sys.path.insert(0, str(MODEL_DIR))
    import live_detector as ld               # noqa: E402  (model/live_detector.py: thresholds, guards, preset)
    import predict as predict_module         # noqa: E402
    from features import window_features     # noqa: E402
    from guards import LevelLogic            # noqa: E402  (same CALM / TENSE / FIGHT logic as live_detector)
    from seq_features import window_inputs   # noqa: E402  (LightGBM features + CNN sequence, one pass)
    if worker is None:
        from predict import predict          # noqa: E402
    else:
        predict = worker

    a = s.args
    cap = open_capture(cv2, src)
    if not cap.isOpened():
        raise SystemExit(f"Cannot open camera/video: {a.camera}")
    is_file = not isinstance(src, int)
    if not is_file:
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, ld.CAM_W)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, ld.CAM_H)
        cap.set(cv2.CAP_PROP_FPS, ld.CAM_FPS)
    file_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    model, model_name, device = load_pose(ld, a.device)
    print(f"Pose model: {model_name}", flush=True)
    start = time.time()

    def capture():
        n, t0 = 0, time.time()
        while s.running:
            ok, frame = cap.read()
            if not ok:
                if is_file and a.loop:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    n, t0 = 0, time.time()
                    continue
                break
            n += 1
            if is_file:
                time.sleep(max(0.0, n / file_fps - (time.time() - t0)))
            with s.lock:
                s.frame, s.frame_id = frame, s.frame_id + 1
        s.running = False

    threading.Thread(target=capture, daemon=True).start()
    rows, frame_times = deque(), deque()
    last_id, next_score = 0, ld.SHORT_S
    logic = LevelLogic(ld.LOGIC_CONFIG)     # model mode, preset thresholds and guards from live_detector.py
    print(f"Scoring: predict.MODE={predict_module.MODE}, FIGHT_AT={ld.ACTIVE_FIGHT_AT}", flush=True)
    while s.running:
        with s.lock:
            frame, fid = s.frame, s.frame_id
        if frame is None or fid == last_id:
            time.sleep(0.002)
            continue
        last_id = fid
        t = time.time() - start
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
            ids = res.boxes.id.int().tolist() if res.boxes.id is not None else list(range(len(xy)))
            for p, pid in enumerate(ids):
                people.append({"id": int(pid), "kp": [[round(float(xy[p, k, 0]) / w, 4),
                                                       round(float(xy[p, k, 1]) / h, 4),
                                                       round(float(conf[p, k]), 2)] for k in COCO_12]})
        annotated = draw(frame.copy(), people, s.level, s.score, a)
        ok, jpg = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 70])
        with s.lock:
            s.people = people
            if ok:
                s.jpeg = jpg.tobytes()

        if t < next_score:
            continue
        next_score = t + ld.SCORE_EVERY_S
        kp = pd.DataFrame(list(rows))
        if predict_module.NEEDS_SEQUENCE:   # ensemble: the CNN needs the keypoint sequence too
            feats, seq = window_inputs(kp, t, frame_times)
        else:
            feats, seq = window_features(kp, t, frame_times), None
        raw = predict(feats, seq)
        level, smooth, blocked = logic.step(t, raw, feats)
        with s.lock:
            s.level, s.score, s.feats, s.updated_at = level, float(smooth), feats, iso_now()
            s.blocked = blocked
            tick_incident(s, time.time())
    cap.release()
    if worker is not None:
        worker.close()


def open_capture(cv2, src):
    """Webcam backends that open fast and reliably per OS; files use the default."""
    if isinstance(src, int):
        if sys.platform == "win32":
            cap = cv2.VideoCapture(src, cv2.CAP_DSHOW)          # DirectShow: fast open on Windows
            if cap.isOpened():
                return cap
            return cv2.VideoCapture(src, cv2.CAP_MSMF)
        if sys.platform == "darwin":
            return cv2.VideoCapture(src, cv2.CAP_AVFOUNDATION)  # macOS asks for camera permission once
    return cv2.VideoCapture(src)


def load_pose(ld, want: str):
    """Pose model per machine. auto: Windows/Linux use the model team's loader (OpenVINO on the
    Intel GPU, then CPU, then PyTorch); macOS uses PyTorch on Apple's GPU (mps), then CPU."""
    import numpy as np
    from ultralytics import YOLO

    def torch_on(device):
        m = YOLO(ld.MODEL_PT)
        m.predict(np.zeros((ld.CAM_H, ld.CAM_W, 3), np.uint8), imgsz=ld.IMGSZ, device=device, verbose=False)
        return m, f"PyTorch {device} {ld.IMGSZ}", device

    if want == "openvino" or (want == "auto" and sys.platform != "darwin"):
        return ld.load_pose_model(ld.IMGSZ)
    order = [want] if want not in ("auto",) else ["mps", "cpu"]
    for device in dict.fromkeys(order + ["cpu"]):
        try:
            return torch_on(device)
        except Exception as e:  # mps missing on Intel Macs, cuda missing, etc.
            print(f"PyTorch on {device} failed ({str(e).splitlines()[0]})", flush=True)
    raise SystemExit("No pose backend worked")


def draw(frame, people, level, score, a):
    import cv2
    h, w = frame.shape[:2]
    for i, p in enumerate(people):
        col = PERSON_BGR[min(i, 2)]
        pts = {COCO_12[j]: (int(x * w), int(y * h)) for j, (x, y, c) in enumerate(p["kp"]) if c >= 0.3}
        for u, v in DRAW_BONES:
            if u in pts and v in pts:
                cv2.line(frame, pts[u], pts[v], col, 3, cv2.LINE_AA)
        for pt in pts.values():
            cv2.circle(frame, pt, 3, (255, 255, 255), -1, cv2.LINE_AA)
    cv2.rectangle(frame, (0, h - 28), (w, h), (22, 27, 34), -1)
    cv2.putText(frame, f"{a.camera_id}  {level}  {score:.2f}", (10, h - 9),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, LEVEL_BGR[level], 2, cv2.LINE_AA)
    return frame


# ------------------------------------------------------------------ fake pipeline (no camera)
def run_fake(s: State):
    """Scripted escalation for testing the dashboard with no camera or model:
    calm 6 s -> tense 5 s -> fight 6 s -> calm 8 s, looping. Clearly labelled FAKE on /live.json."""
    script = [("CALM", 0.2, 6), ("TENSE", 0.6, 5), ("FIGHT", 0.9, 6), ("CALM", 0.15, 8)]
    while s.running:
        for level, score, dur in script:
            end = time.time() + dur
            while time.time() < end and s.running:
                k = random.random() * 0.02
                d = 0.08 if level == "FIGHT" else 0.12 if level == "TENSE" else 0.2
                people = [
                    {"id": 1, "kp": _fake_pose(0.5 - d / 2 + k)},
                    {"id": 2, "kp": _fake_pose(0.5 + d / 2 - k)},
                ]
                feats = {"pair_motion_energy": score * 0.9, "close_motion": score * 0.8,
                         "max_wrist_speed": score * 5, "min_torso_dist": 1.5 - score}
                with s.lock:
                    s.people, s.level, s.score, s.feats = people, level, score + k, feats
                    s.updated_at = iso_now()
                    tick_incident(s, time.time())
                time.sleep(0.5)


def _fake_pose(cx: float) -> list:
    pts = [(-0.02, 0.35), (0.02, 0.35), (-0.04, 0.45), (0.04, 0.45), (-0.05, 0.55), (0.05, 0.52),
           (-0.015, 0.58), (0.015, 0.58), (-0.02, 0.72), (0.02, 0.72), (-0.02, 0.86), (0.02, 0.86)]
    return [[round(cx + dx, 4), round(y, 4), 0.9] for dx, y in pts]


# ------------------------------------------------------------------ HTTP
def make_handler(s: State):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _cors(self):
            # The dashboard may be served from Vercel (https) and read this laptop's 127.0.0.1.
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

        def _clip(self, name):
            # Only <incident_id>.mp4 straight inside edge/clips/. Byte ranges so the browser can seek.
            f = CLIPS / name
            if "/" in name or not name.endswith(".mp4") or not f.is_file():
                return self._json({"error": "no clip for this incident on this laptop"}, 404)
            size = f.stat().st_size
            start, end = 0, size - 1
            rng = self.headers.get("Range", "")
            if rng.startswith("bytes="):
                a, _, b = rng[6:].split(",")[0].partition("-")
                start = int(a) if a else max(0, size - int(b or 0))
                end = min(int(b), size - 1) if a and b else end
            if start > end:
                self.send_response(416)
                self._cors()
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return None
            self.send_response(206 if rng else 200)
            self._cors()
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(end - start + 1))
            if rng:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            try:
                with f.open("rb") as fh:
                    fh.seek(start)
                    left = end - start + 1
                    while left > 0:
                        chunk = fh.read(min(1 << 16, left))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        left -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return None

        def do_GET(self):
            path = self.path.split("?")[0]
            a = s.args
            if path == "/health":
                return self._json({"ok": True, "camera_id": a.camera_id, "source": a.source,
                                   "fake": a.fake})
            if path == "/live.json":
                with s.lock:
                    inc = dict(s.incident) if s.incident else None
                    body = {"camera_id": a.camera_id, "source": a.source, "fake": a.fake,
                            "level": s.level.lower(), "score": round(s.score, 3),
                            "people_count": len(s.people), "updated_at": s.updated_at,
                            "snapshot": {"t": s.updated_at, "people": s.people},
                            "incident": inc, "posts": list(s.post_log)[-5:]}
                return self._json(body)
            if path == "/stream.mjpg":
                if a.fake:
                    return self._json({"error": "no video in --fake mode"}, 404)
                self.send_response(200)
                self._cors()
                self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
                self.end_headers()
                try:
                    while s.running:
                        with s.lock:
                            jpg = s.jpeg
                        if jpg:
                            self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                                             + str(len(jpg)).encode() + b"\r\n\r\n" + jpg + b"\r\n")
                        time.sleep(1 / STREAM_FPS)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return None
            if path in ("/clips", "/clips/"):
                ids = sorted(f.stem for f in CLIPS.glob("*.mp4")) if CLIPS.is_dir() else []
                return self._json({"incident_ids": ids})
            if path.startswith("/clips/"):
                return self._clip(path[len("/clips/"):])
            return self._json({"error": "not found"}, 404)
    return H


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--camera", default="0", help="webcam index or a video file path")
    ap.add_argument("--loop", action="store_true", help="loop a video file (recordings)")
    ap.add_argument("--source", default="live", choices=["live", "recorded"])
    ap.add_argument("--camera-id", default="CAM-AU-01")
    ap.add_argument("--location", default="Grand Hall")
    ap.add_argument("--zone", default="auditorium")
    ap.add_argument("--zone-risk", type=float, default=0.5)
    ap.add_argument("--staff", default="Guard B", help="nearest person on duty for this camera")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--api", default=os.environ.get("EARLYEYE_API", "https://earl-eye-backend.onrender.com"))
    ap.add_argument("--no-post", action="store_true", help="do not post events to the API")
    ap.add_argument("--upsert", action="store_true", help="API upserts by incident_id: post every 0.5 s")
    ap.add_argument("--fake", action="store_true", help="scripted escalation, no camera or model")
    ap.add_argument("--device", default="auto", choices=["auto", "openvino", "mps", "cuda", "cpu"],
                    help="pose backend; auto = OpenVINO on Windows/Linux, Apple GPU (mps) on macOS")
    args = ap.parse_args()

    s = State(args)
    srv = ThreadingHTTPServer((args.host, args.port), make_handler(s))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    print(f"EarlyEye edge {args.camera_id} ({args.source}{', FAKE' if args.fake else ''}) on "
          f"http://{args.host}:{args.port}  ·  posting to {'nothing' if args.no_post else args.api}"
          f"{' (upsert)' if args.upsert else ' (once per incident, at fight)'}", flush=True)
    try:
        run_fake(s) if args.fake else run_model(s)
    except KeyboardInterrupt:
        pass
    finally:
        s.running = False
        srv.shutdown()


if __name__ == "__main__":
    main()
