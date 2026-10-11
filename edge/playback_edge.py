"""
A recorded CCTV camera with no model at play time: loops a video that edge/annotate_clip.py already
ran through the model (skeletons, level and score drawn in) and serves the same endpoints as
earlyeye_edge.py (/health, /live.json, /stream.mjpg), reading level and score from the saved track.
Keeps the laptop's GPU for the live webcam. Never posts, never alarms (source "recorded").

  edge/.venv/bin/python edge/playback_edge.py --video edge/recordings/played/clip3.mp4 \\
      --track edge/recordings/played/clip3.track.json --camera-id CAM-SC-06 --port 8769
"""
from __future__ import annotations

import argparse
import bisect
import json
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2

MYT = timezone(timedelta(hours=8))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--track", required=True)
    ap.add_argument("--camera-id", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--label", default="SAMPLE CCTV CLIP")
    a, _ = ap.parse_known_args()

    tr = json.load(open(a.track))
    track = tr["track"] or [{"t": 0.0, "level": "calm", "score": 0.0, "people": []}]
    times = [x["t"] for x in track]
    st = {"jpeg": None, "t": 0.0}
    lock = threading.Lock()

    def play():
        while True:
            cap = cv2.VideoCapture(a.video)
            fps = cap.get(cv2.CAP_PROP_FPS) or tr.get("fps") or 15.0
            t0, i = time.time(), 0
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                ok, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
                with lock:
                    st["jpeg"], st["t"] = (jpg.tobytes() if ok else st["jpeg"]), i / fps
                i += 1
                time.sleep(max(0.0, t0 + i / fps - time.time()))   # real speed
            cap.release()

    threading.Thread(target=play, daemon=True).start()

    def now_entry():
        with lock:
            t = st["t"]
        return track[max(0, bisect.bisect_right(times, t) - 1)]

    class H(BaseHTTPRequestHandler):
        def _cors(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Allow-Headers", "*")
            self.send_header("Cache-Control", "no-store")

        def _json(self, body, code=200):
            data = json.dumps(body).encode()
            self.send_response(code)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_GET(self):
            path = self.path.split("?")[0]
            if path == "/health":
                return self._json({"ok": True, "camera_id": a.camera_id, "source": "recorded", "fake": False,
                                   "label": a.label, "playback": True})
            if path == "/live.json":
                e, at = now_entry(), datetime.now(MYT).isoformat(timespec="seconds")
                return self._json({"camera_id": a.camera_id, "source": "recorded", "fake": False,
                                   "level": e["level"], "score": e["score"], "people_count": len(e["people"]),
                                   "updated_at": at, "snapshot": {"t": at, "people": e["people"]},
                                   "incident": None, "posts": [], "playback": True})
            if path in ("/clips", "/clips/"):
                return self._json({"incident_ids": []})
            if path == "/stream.mjpg":
                self.send_response(200)
                self._cors()
                self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
                self.end_headers()
                try:
                    while True:
                        with lock:
                            jpg = st["jpeg"]
                        if jpg:
                            self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                                             + str(len(jpg)).encode() + b"\r\n\r\n" + jpg + b"\r\n")
                        time.sleep(1 / 12)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return None
            return self._json({"error": "not found"}, 404)

        def log_message(self, *args):
            pass

    print(f"playback {a.camera_id} on :{a.port} (no model; {a.video})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", a.port), H).serve_forever()


if __name__ == "__main__":
    main()
