"""
Camera wake-up on the demo laptop. Opening the dashboard turns the cameras on; closing every
dashboard tab turns them off again after IDLE_S, so the laptop (and the webcam) can rest.

  edge/.venv/bin/python edge/launcher.py          # or install at login: edge/install_launcher.sh

Serves 127.0.0.1:8700 only (never the network). Uses no camera and almost no CPU itself:
  GET /wake    start the cameras (edge/run_all.py) if they're off; also counts as a ping
  GET /ping    the dashboard is still open
  GET /status  {"running": bool, "started_by_me": bool, "idle_s": n}
Cameras started by hand (edge/run_edge.sh all) are left alone: it only stops what it started.
"""
from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PORT = int(os.environ.get("EE_LAUNCHER_PORT", "8700"))
IDLE_S = float(os.environ.get("EE_LAUNCHER_IDLE_S", "120"))
LIVE_PORT = 8765   # the webcam edge (edge/cameras.json "live")

lock = threading.Lock()
proc: subprocess.Popen | None = None
last_ping = 0.0


def cameras_up() -> bool:
    """Something already serves the webcam edge's port (ours or started by hand)."""
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", LIVE_PORT)) == 0


def ours_running() -> bool:
    return proc is not None and proc.poll() is None


def wake():
    global proc
    with lock:
        if ours_running() or cameras_up():
            return
        log = open(REPO / "edge" / "launcher.log", "ab")
        proc = subprocess.Popen([str(REPO / "edge" / "run_edge.sh"), "all"], cwd=REPO, stdout=log,
                                stderr=subprocess.STDOUT, start_new_session=True)
        print(f"{time.strftime('%H:%M:%S')} cameras on (pid {proc.pid})", flush=True)


def stop():
    global proc
    with lock:
        if not ours_running():
            return
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=10)
        except Exception:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except Exception:
                pass
        print(f"{time.strftime('%H:%M:%S')} cameras off: no dashboard open for {IDLE_S:.0f} s", flush=True)
        proc = None


def watchdog():
    while True:
        time.sleep(5)
        if ours_running() and time.time() - last_ping > IDLE_S:
            stop()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")   # https site → laptop
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        global last_ping
        path = self.path.split("?")[0]
        if path in ("/wake", "/ping"):
            last_ping = time.time()
            if path == "/wake":
                wake()
        elif path != "/status":
            return self._send(404, {"error": "not found"})
        self._send(200, {"running": ours_running() or cameras_up(), "started_by_me": ours_running(),
                         "idle_s": round(time.time() - last_ping) if last_ping else None})

    def log_message(self, *a):
        pass


def main():
    signal.signal(signal.SIGTERM, lambda *_: (stop(), sys.exit(0)))
    threading.Thread(target=watchdog, daemon=True).start()
    print(f"EarlyEye camera wake-up on http://127.0.0.1:{PORT} (cameras off after {IDLE_S:.0f} s idle)", flush=True)
    try:
        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    finally:
        stop()


if __name__ == "__main__":
    main()
