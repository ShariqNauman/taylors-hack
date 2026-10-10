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

## Run on the demo laptop (Python 3.11)

```bash
python3.11 -m venv edge/.venv
edge/.venv/bin/python -m pip install -r model/requirements.txt       # Windows: edge\.venv\Scripts\python
edge/.venv/bin/python edge/earlyeye_edge.py                           # webcam 0 = CAM-AU-01, Grand Hall
```

Then open the dashboard **on the same laptop** (Vercel link or `npm start` in `web/`). The header shows
`ON-SITE DESK` and the Live screen follows the webcam.

- Recordings: `--camera clip.mp4 --loop --source recorded --camera-id CAM-BC-03 --location "Block C stairwell" --zone stairwell --zone-risk 0.8 --port 8766` (ports 8766–8769 match `web/public/mock/cameras.json`).
- No camera, no model: `--fake` plays calm → tense → fight → calm on a loop. Use it to rehearse the dashboard.
- Post nothing: `--no-post`. Other API: `--api https://…` or `EARLYEYE_API`.

## Posting rule

The API on main inserts on `POST /events` and does not upsert, so by default the bridge posts **once per
incident, at the first FIGHT** (the alarm moment). Tense stays on the on-site dashboard, which is the two-tier
rule anyway. When the API upserts by `incident_id` (docs/work-split.md B5), run with `--upsert` to post every
0.5 s and close incidents with `end_time`.

The API pushes only when its `staff` table has someone for the camera's zone. For CAM-AU-01 that is zone
`auditorium`: add Guard B there, or the operator presses **Push Guard B now** on the Live card.
