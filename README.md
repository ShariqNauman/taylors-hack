# EarlyEye

**Physical-aggression early warning for any site that already has cameras and a security desk.**

Dormathon 2026 · Taylor's University · Track 1, Predictive Model — *Predict Early, Decide Better*

---

### 🎥 Physical Violence Prediction Demo

> **Watch EarlyEye's 17-keypoint temporal violence detector running on benchmark surveillance footage:**

<div align="center">
  <video src="docs/voilence-prediction-demo.mp4" controls="controls" width="100%" poster="docs/demo-poster.jpg" style="max-height: 460px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
    Your browser does not support the video tag.
  </video>
  <p>
    📹 <strong><a href="docs/voilence-prediction-demo.mp4">▶ Click to Open / Download the full Violence Prediction Demo Video (docs/voilence-prediction-demo.mp4)</a></strong>
  </p>
</div>

---

| | |
|---|---|
| **Live dashboard** | `TODO_VERCEL_URL` (Kayla fills this in at submission) |
| **API** | https://earl-eye-backend.onrender.com (`/health`, `/site`, `/cameras`, `/events`, `/hotspots`, `/plan`, `/proof`) |
| **Demo with no camera** | open the dashboard on a laptop. The recorded escalation plays by itself (`?replay=1` forces it, `?replay=0` shows the quiet state). |
| **Guard app (phones only)** | `TODO_VERCEL_URL/guard`. Pick a person, tap **Start my shift**, then watch the laptop's replay ring the phone. `/push?staff=Guard%20B` still works and opens the same app. |

---

## The problem

One operator, thirty screens. Malaysia's own ministry audit of 54 boarding schools found **24 with properly working CCTV**, and nobody watches the ones that work at 2am. Cameras today are for the police report afterwards. Guard posts cost ~RM103k a year and still cannot watch forty feeds.

## What EarlyEye does

A pose model turns people into 12-point skeletons — **no faces, no identities, and the video never leaves the site**. A classifier scores the *build-up*, not just the punch, and the system answers four questions a security desk actually has:

| Judges' rubric | EarlyEye |
|---|---|
| **Detect** | Risk score per 0.5 s; time-to-incident from the rising trend ("fight likely in ~6 s") |
| **Categorize** | Four incident *types*: fight · cornering · crowd · play |
| **Prioritize** | `severity × confidence × zone risk × people`, one ranked queue across every camera; weekly, hotspots ranked by incidents avoided per patrol hour |
| **Explain** | One plain sentence: *"Five people stopped and faced the same point for 4 s."* No jargon, no raw feature dumps |
| **Decide** | A named person is pushed to their phone, which goes full-screen red. Their tap is both a response time and a training label. Monday: a patrol plan |

**Two-tier alerting** is the false-alarm design: `tense` is silent on the dashboard and pings nobody; only sustained `fight_likely` or `fight` wakes a human, capped at 3 pushes per shift.

## Screens

| Route | Who | What |
|---|---|---|
| `/` | Desk operator (laptop) | Alert card with the guard's progress (alerted → on the way → there → what they found), ranked queue, camera wall, 3D campus, alarm, shift handover |
| `/guard` | Guard on duty (phone) | Installable app: Today, Schedule, Alerts, Me; the alarm takes over the screen; On my way → I'm here → What did you find? |
| `/plan` | Security supervisor | Standing guard posts, the daily 06:00 suggestion, add or edit a post, who goes, the next 7 days, the numbers behind it |
| `/incidents` | Security manager | Every alert as a case: decision, what EarlyEye saw, the guard's steps, notes |
| `/cameras` | Everyone | Camera health, including "black for 3 days", and the 3D campus |
| `/proof` (Track record) | Manager, judges | Can you trust the alarms? From the desk's yes/no answers; what EarlyEye suggests changing; the model tests in a folded section |

Phones always get the guard app: a phone that opens a desk page is sent to `/guard`.

## What the model is, honestly

- **LightGBM** on 12-keypoint pose features (YOLO26n-pose + ByteTrack), 2 s windows scored every 0.5 s, all distances scaled by torso length.
- **3,131 clips** across four datasets: RLVS, AIRTLab, Surveillance Camera Fight, SCVD.
- **GroupKFold split by video**, never by window. Clip score = max window.
- Alarm fires when the smoothed score holds ≥ 0.75 for 1.0 s.

| Measured | Value |
|---|---|
| Clip ROC-AUC (out-of-fold, phone-video sets) | **0.887** |
| CCTV angle, **held out of training** (SCF + SCVD) | AUC 0.709 · precision 0.803 · recall 0.317 |
| AIRTLab hugs / claps that cross the alarm line | **19%** |
| Inference latency | 38 ms/frame |

**Not measured yet, and the app says so on every tile:** live-room precision/recall, false alarms per camera-hour, lead time before a shove, night/infrared. These need our own venue footage; the `/proof` page renders them as hatched "not measured" cards rather than numbers.

That 19% is why the two-tier rule exists: one in five hugs crosses the raw model threshold, so `tense` never pings a human.

**We do not claim:** verbal or online bullying, weapon recognition, or night/IR performance.

## Run it

```bash
# API
cd api && pip install -r requirements.txt && cp .env.example .env && uvicorn api.main:app --reload

# Dashboard (works fully offline on mock data)
cd web && npm install && npm run dev        # http://localhost:3000
# or, for the demo: npm run build && npx next start -H 0.0.0.0 -p 3000

# Edge: laptop webcam → API
cd edge && pip install -r requirements.txt && ./run_edge.sh
```

### Phone preview, for guards only

The laptop serves the guard app to phones on the same network:

1. Put the phone on the same Wi-Fi as the laptop, or on the laptop's hotspot (or the laptop on the phone's).
2. Find the laptop's address: `ipconfig getifaddr en0` (macOS) or `ipconfig` (Windows).
3. On the phone, open `http://<laptop-ip>:3000/guard`.

Without an API, the laptop's server keeps a shared demo store (`web/.local-store.json`, git-ignored): the desk's pushes, the guard's taps, posts and check-ins sync between the laptop and every phone on that server within 2 s. Delete the file and restart to reset the demo.

"Add to Home Screen" and keeping the screen awake need **https**. For that, run a Cloudflare tunnel from the laptop (`cloudflared tunnel --url http://localhost:3000`) and open its `https://….trycloudflare.com/guard` link on the phone.

### Alarms with the app closed (Web Push)

On **Start my shift** the guard app asks to allow notifications and registers the phone for that guard. From then on, every alarm pushed to that guard wakes the phone with a notification, even when EarlyEye is closed. The notification shows the level, the place and the reason; tapping it opens the app on the alarm.

- **Deployed:** the API sends the pushes. Run `api/sql/migration_push.sql` in Supabase, run `python -m api.scripts.gen_vapid`, and put `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` into Render's environment. The web app needs no extra setting.
- **Laptop demo:** the laptop's server sends them itself, with keys it generates into `web/.local-vapid.json` (git-ignored). The phone must use an https link, e.g. a Cloudflare tunnel.
- **Phones:** Android works in Chrome. iPhone (iOS 16.4+) only after **Add to Home Screen**, opening EarlyEye from that icon, and allowing notifications. The **Me** tab shows the state ("On", "Add to Home Screen first", "Blocked in settings"…).
- Ending the shift or switching person stops the alarms on that phone.

### Environment variables (web)

| Variable | What it does | Default |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | The FastAPI base URL (Render). Unset = mock data and the shared demo store. | unset |
| `NEXT_PUBLIC_API_RESOURCES` | Which reads come from the API, e.g. `events,site,cameras,plan,hotspots,proof`. Anything else, or anything slower than 4 s, falls back to mock. | `events` |
| `NEXT_PUBLIC_EDGE_URL` | The camera laptop's edge process, for live video on site only. | `http://127.0.0.1:8765` |

A deployed build without `NEXT_PUBLIC_API_URL` shows the chip **Demo data · changes stay on this device**: the shared store only syncs devices that use the same server.

The dashboard renders every screen from `web/public/mock/*.json` when no API is reachable, so the demo never depends on a cold Render instance. Mock skeletons are stamped **SYNTHETIC POSES** in the UI; `web/public/mock/proof.json` is byte-identical to `model/proof.json`, so the page can never show a number the model did not produce.

## Deploy

**Dashboard — Vercel.** Root Directory **`web`** (the repo root is not the app). Build and output settings are the Next.js defaults.

| Variable | Value |
|---|---|
| `EE_API_URL` | `https://earl-eye-backend.onrender.com` |

That is the only one to set. It is read on the server, never inlined into the browser bundle, and it does one job: the end-of-shift brief is forwarded to the API so the deployed site gets Claude's wording. **No model key belongs in the frontend** — no frontend code path reads one.

Leave `NEXT_PUBLIC_API_URL` unset. Every screen then renders from `web/public/mock/*.json`, which is what makes the deployed link demo itself with no camera and no cold Render instance. The API is seeded with a different site — its events name cameras (`CAM-ASR-03`, `CAM-CPK-01`, …) that the mock camera wall and the 3D campus do not have — so pointing the dashboard at it puts incidents on screen with nowhere to show them. See `web/.env.example`.

**API — Render.** Blueprint in `render.yaml`; `pip install -r api/requirements.txt`, then `uvicorn api.main:app`. Set in the dashboard:

| Variable | Value |
|---|---|
| `SUPABASE_URL`, `SUPABASE_KEY` | from Supabase → Project Settings → API |
| `ANTHROPIC_API_KEY` | the API is the only place a model key lives |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` |
| `CORS_ORIGINS` | `*` |

`OPENAI_API_KEY` is optional and only used for knowledge-bank embeddings; nothing in the demo path needs it.

The service boots without any of them: `/health` and `/proof` answer regardless, because `/proof` reads `model/proof.json` from disk rather than the database. Endpoints that need Supabase fail individually instead of taking the process down.

**Edge stays on the laptop by design** — the video never leaves the site, so there is nothing to deploy.

## Repo

```
edge/    webcam → pose → features → score → POST /events   (video stays here)
model/   dataset build, training, live detector, REPORT.md, proof.json
api/     FastAPI + Supabase: events, push rule, hotspots, patrol plan, proof
web/     Next.js dashboard + duty-phone screen
docs/    team plan, system proposal, work split, business case, hackathon brief
```

## Privacy

12 body keypoints per person. No face points, no identities, no stored video — only the event record leaves the laptop. A human always decides; the system recommends one action and one person. Answers the desk and guards give are kept as training examples as stick figures only, never video. Staff names and pictures are employee data: only the security team sees them (the demo team uses illustrations, not photos of real people). Malaysia's PDPA still applies to CCTV, and minimal-data-by-design is what makes a site's review passable.

## Limitations

- **Mock fallback.** Every screen renders from mock data when the API is slow or down, and says so in the header. Numbers on Track record come only from the desk's answers; below 10 answers it says "not enough answers yet".
- **No auth in the pilot.** Anyone with the link can change posts, labels and camera settings, and the API accepts writes without a login.
- **Untested at night or on infrared.** Every measured number comes from daylight or indoor footage.
- **No push notifications.** The guard app polls every 2 s and must stay open during the shift. Web Push is the production answer. iPhones don't vibrate from a web page.
- **One live webcam.** The other cameras in the demo are labelled recordings or a black camera, never shown as live.

## Where it goes

University campuses and hostels first (24/7 control room, adults, opex budget) → private day schools → malls, factories, transit → the 533 government school hostels already funded at ~RM15k a set, once infrared is measured. RM45 per camera per month on cameras the site already owns: about a quarter of one guard post, for forty screens instead of one. Full case in `docs/earlyeye-business-case.md`.
