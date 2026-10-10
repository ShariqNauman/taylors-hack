# edge/ — the bridge between the live model and the dashboard

`earlyeye_edge.py` runs the model team's live pipeline (`model/live_detector.py`: YOLO26n-pose + ByteTrack,
`features.window_features`, `predict.py`, the same smoothing and CALM / TENSE / FIGHT thresholds). It imports
that code read-only, and adds what the dashboard needs:

| Endpoint | What | Who uses it |
|---|---|---|
| `GET /health` | `{ok, camera_id, source}` | Dashboard's on-site probe; when it answers, the page switches to ON-SITE DESK |
| `GET /stream.mjpg` | Webcam with skeletons drawn, ~10 fps | On-site video only. Never leaves the laptop |
| `GET /live.json` | Level, score, people, current incident with `snapshot` + `top_features` | On-site Live screen, polled every 0.5 s |
| `POST <API>/events` | The event record (contract in `docs/kayla-frontend-plan.md`) | Render API → remote dashboard, phone |

## Run on the demo laptop

One command per OS. The first run creates `edge/.venv` (Python 3.11) and installs `edge/requirements.txt`
(same pins as `model/requirements.txt`); later runs start straight away. The pose weights download once.

| Laptop | Command | Pose runs on |
|---|---|---|
| Windows (Intel) | `edge\run_edge.bat` | OpenVINO on the Intel GPU, then CPU (the model team's loader) |
| MacBook, Apple Silicon | `edge/run_edge.sh` | PyTorch on the Apple GPU (`mps`), then CPU |
| MacBook, Intel | `edge/run_edge.sh` | PyTorch on CPU (`--device openvino` if you install openvino) |

Needs Python 3.11. Windows: from python.org (tick "Add to PATH"). macOS: the launcher uses `uv`'s
self-contained Python 3.11 (it installs `uv` with Homebrew if missing), because Homebrew's python@3.11
breaks on macOS 26 (pyexpat vs the system libexpat, which also breaks pip). On macOS, LightGBM runs in a
small separate process: PyTorch and LightGBM ship different OpenMP runtimes and segfault in one process.
macOS also needs `brew install libomp` for LightGBM, and asks once for camera permission for the terminal
(System Settings → Privacy & Security → Camera). Windows opens the webcam through DirectShow.

Options go after the command, for example `edge/run_edge.sh --camera 1` or `edge\run_edge.bat --fake`.

Then open the dashboard **on the same laptop** in **Chrome or Edge** (Vercel link, or `npm run build && npm start`
in `web/` for http://localhost:3000). The header shows `ON-SITE DESK` and Live follows the webcam. Safari blocks an
https page from reading `http://127.0.0.1`, so on a Mac use Chrome, or the local `npm start` dashboard.

- Recordings: `--camera clip.mp4 --loop --source recorded --camera-id CAM-BC-03 --location "Block C stairwell" --zone stairwell --zone-risk 0.8 --port 8766` (ports 8766–8769 match `web/public/mock/cameras.json`).
- No camera, no model: `--fake` plays calm → tense → fight → calm on a loop. Use it to rehearse the dashboard.
- Post nothing: `--no-post`. Other API: `--api https://…` or `EARLYEYE_API`. Pose backend: `--device auto|openvino|mps|cuda|cpu`.

## Posting rule

The API on main inserts on `POST /events` and does not upsert, so by default the bridge posts **once per
incident, at the first FIGHT** (the alarm moment). Tense stays on the on-site dashboard, which is the two-tier
rule anyway. When the API upserts by `incident_id` (docs/work-split.md B5), run with `--upsert` to post every
0.5 s and close incidents with `end_time`.

The API pushes only when its `staff` table has someone for the camera's zone. For CAM-AU-01 that is zone
`auditorium`: add Guard B there, or the operator presses **Push Guard B now** on the Live card.
