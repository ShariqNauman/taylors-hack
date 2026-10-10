# EarlyEye

**Physical-aggression early warning for any site that already has cameras and a security desk.**

Dormathon 2026 · Taylor's University · Track 1, Predictive Model — *Predict Early, Decide Better*

| | |
|---|---|
| **Live dashboard** | `TODO_VERCEL_URL` |
| **API** | https://earl-eye-backend.onrender.com (`/health`, `/site`, `/cameras`, `/events`, `/hotspots`, `/plan`, `/proof`) |
| **Demo with no camera** | open the dashboard — the recorded escalation plays by itself. `?replay=0` to see the quiet state. |
| **Duty phone** | `TODO_VERCEL_URL/push?staff=Guard%20B` — tap "I'm on duty", then `?demo=1` to fire a test push |

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
| `/` | Desk operator | Alert card, ranked queue, camera wall, 3D campus, alarm |
| `/push` | Person on duty | Phone takeover: red screen, countdown, one tap |
| `/plan` | Security manager | Top-3 patrol slots with a stated assumption, hour-of-week heatmap |
| `/incidents` | Security manager | 8 weeks of history, labels, staff notes |
| `/cameras` | Everyone | Camera health — including "black for 3 days" |
| `/proof` | Buyer, evaluator | What is measured, what is not, and why |

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

# Edge: laptop webcam → API
cd edge && pip install -r requirements.txt && ./run_edge.sh
```

The dashboard renders every screen from `web/public/mock/*.json` when no API is reachable, so the demo never depends on a cold Render instance. Mock skeletons are stamped **SYNTHETIC POSES** in the UI; `web/public/mock/proof.json` is byte-identical to `model/proof.json`, so the page can never show a number the model did not produce.

## Repo

```
edge/    webcam → pose → features → score → POST /events   (video stays here)
model/   dataset build, training, live detector, REPORT.md, proof.json
api/     FastAPI + Supabase: events, push rule, hotspots, patrol plan, proof
web/     Next.js dashboard + duty-phone screen
docs/    team plan, system proposal, work split, business case, hackathon brief
```

## Privacy

12 body keypoints per person. No face points, no identities, no stored video — only the event record leaves the laptop. A human always decides; the system recommends one action and one person. Malaysia's PDPA still applies to CCTV, and minimal-data-by-design is what makes a site's review passable.

## Where it goes

University campuses and hostels first (24/7 control room, adults, opex budget) → private day schools → malls, factories, transit → the 533 government school hostels already funded at ~RM15k a set, once infrared is measured. RM45 per camera per month on cameras the site already owns: about a quarter of one guard post, for forty screens instead of one. Full case in `docs/earlyeye-business-case.md`.
