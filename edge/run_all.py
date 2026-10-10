"""
Start every camera from edge/cameras.json: the live webcam (posts to the API unless --no-post)
plus each recording (never posts; labelled SAMPLE CCTV CLIP on the stream). Ctrl+C stops all.
Usage: <venv python> edge/run_all.py [--no-post] [--fake-live]
"""
import json
import signal
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
cfg = json.loads((REPO / "edge" / "cameras.json").read_text())
py = sys.executable
bridge = str(REPO / "edge" / "earlyeye_edge.py")
procs = []
RECORDING_POSE_FPS = 10   # sample CCTV recordings: pose at most this often

def start(args, name):
    print(f"starting {name}: port {args[args.index('--port') + 1]}", flush=True)
    procs.append(subprocess.Popen([py, bridge, *args], cwd=REPO))

for r in cfg["recordings"]:
    f = REPO / r["file"]
    if not f.exists():
        print(f"skip {r['camera_id']}: {r['file']} not found", flush=True)
        continue
    # Sample recordings share the laptop with the live webcam: cap their pose rate so the webcam keeps
    # most of the GPU (the live model needs >= ~15 pose fps; recordings never post incidents).
    start(["--camera", str(f), "--loop", "--source", "recorded", "--no-post", "--pose-fps", str(RECORDING_POSE_FPS),
           "--label", "SAMPLE CCTV CLIP", "--camera-id", r["camera_id"], "--location", r["location"],
           "--zone", r["zone"], "--zone-risk", str(r["zone_risk"]), "--staff", r["staff"],
           "--port", str(r["port"])], r["camera_id"])
live = cfg["live"]
args = ["--camera", live["camera"], "--camera-id", live["camera_id"], "--location", live["location"],
        "--zone", live["zone"], "--zone-risk", str(live["zone_risk"]), "--staff", live["staff"],
        "--port", str(live["port"])]
if "--no-post" in sys.argv:
    args.append("--no-post")
if "--fake-live" in sys.argv:
    args.append("--fake")
start(args, live["camera_id"])

def stop(*_):
    for p in procs:
        p.terminate()
    for p in procs:
        try:
            p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            p.kill()
    sys.exit(0)

signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)
while True:
    time.sleep(1)
