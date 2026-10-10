# EarlyEye — Dormathon 2026, Track 1 (Predictive Model)

Read this first. Full plan: `docs/earlyeye-TEAM-FINAL.md`. Rubric and judges verbatim: `docs/hackathon-brief.md`. Frontend: `docs/kayla-frontend-plan.md`. **Who builds what (backend vs frontend, with acceptance tests): `docs/work-split.md`.** Users, journeys, approved system decisions: `docs/earlyeye-system-proposal.md`. Business case: `docs/earlyeye-business-case.md`.

## Hard facts
- Taylor's University branch. Build Sat 10 Oct 14:00 → **submit Sun 11 Oct 08:30** (hard buffer 09:00, deadline 09:30).
- Submission: **public GitHub + deployed app link + slides PDF + team name/branch**. The deployed link is non-negotiable; the Vercel dashboard must be useful with no camera attached.
- Pitch: Phase 1 = 3 min + 2 min Q&A in person, live camera demo. Phase 2 (top 18) = 4 min + 3 min on a video call: recorded escalation video + live dashboard fed by `edge/replay.py`. Never act live over a call.
- Rubric (judges' words): every solution must **Detect, Categorize, Prioritize, Explain**. Strong = specific real problem, clear user, supports decisions, robust on noisy/unfamiliar data, minimizes false alarms, clear recommendations, measurable impact with realistic assumptions. Core question: **"Does your model help someone make a better decision, and can you prove it?"**

## The product
EarlyEye: **physical-aggression early warning for any site with cameras and a security desk** (campuses + hostels, schools, malls, factories, transit). Pose model → skeleton features (never faces) → classifier scores the build-up → **type** (fight / cornering / crowd / play) + **severity** (tense / fight_likely / fight) + **ETA** ("fight likely in ~6 s") + **priority** across cameras (zone risk from a per-site table) + one-sentence **reason** + **action** + nearest person. **Two-tier alerts:** tense is silent; fight_likely+ pushes one person with Confirm/Dismiss (a label). Every alert is an incident record; weekly, hotspots become a **patrol plan** ("one person at Block C stairwell, Mon–Thu 13:00–14:00, ~3 avoided/week"). Camera-health tile ("black for 3 days"). Video never leaves the laptop; only the event JSON goes up.

Claim discipline: we detect *physical* aggression and crowding; never claim verbal/online bullying. UI is site-agnostic (site, zone, operator); the demo site is **Taylor's Lakeside campus**.

Segments in order: universities + hostels (24/7 control room, adults, opex) → private day schools → malls/factories/transit → government school hostels (vision slide; IR/night untested, say so).

Say first, before a judge does: school bullying cases 7,681 in 2024, **fell to 5,038 in 2025**; the ministry audit found 24 of 54 boarding schools with working CCTV. Hook: "one operator, thirty screens."

## Stack
```
edge/  Python: Ultralytics YOLO26n-pose + tracker, OpenCV, features (1 s window, stride 0.5, torso-scaled), RF/LightGBM + rules → POST /events
api/   FastAPI on Render: POST /events, GET /events?since=, GET /hotspots, GET /proof, (SHOULD) POST /report → Supabase Postgres (free tier)
web/   Next.js 15 App Router + TS + Tailwind + shadcn/ui + Recharts on Vercel: live queue, alert card, heatmap, incidents, proof page. Polls every 2 s; renders from /public/mock/*.json when the API is down.
model/ extract.py (GPU, resumable), features.py, train.py (GroupKFold by video), thresholds.json, proof.json, model.pkl
data/  keypoints/*.npz, own_clips/, fake_term_incidents.csv (300–500, 2–3 planted patterns), cameras.json, staff.json
```
Claude `claude-sonnet-5-5` only for the SHOULD weekly report (reads SQL output). Never in detection.
Secrets only in Render/Vercel env vars. `grep -r sk-ant` and Supabase keys before the repo goes public.

## Non-negotiable modelling rules
- Train on RLVS + AIRTLab keypoints. **Hold out Surveillance Camera Fight + SCVD as the CCTV-domain test** (team plan §5.6b); if retrained with them included, report both rows. RWF-2000 is withdrawn; never cite it as used.
- **System decisions approved 10 Oct 14:50** (docs/earlyeye-system-proposal.md): contract = frontend version + `acked_at`; API owns push fields and the shift budget (budget caps `fight_likely` only, `fight` always pushes); edge heartbeat every 10 s, `black_since` computed on read; patrol maths 0.75/week ("~3 a month"); rank by avoided/week, show per-hour beside; replay by timestamps; operator labels on Live, phone tap = `acked_at`. Edge never overwrites human-set fields. Staff table lives in `GET /site`.
- **Phone pop-out:** `/push?staff=` page with an "I'm on duty" tap (unlocks audio, wake lock, fullscreen), then full-screen red card + sound + vibrate on push (MUST). Telegram bot message with the link (SHOULD, after 23:00). Web Push/PWA is the production answer, Q&A only.
- Work split: `docs/work-split.md`.
- **GroupKFold by video**, never by window. Report clip-level precision/recall/AUC. Calibrate.
- Types are **rules on top of the score** (fight / cornering: 1 vs ≥3 within 2 torso-lengths >5 s / crowd / play-sports). Say so; don't call them a model.
- **Threshold tuned on our own venue footage** for ≤1 false alarm per camera-hour. "Tense" is silent; alarm only at fight_likely+; 1-s persistence.
- **Lead time** = seconds between amber and the shove on our 5 escalation clips. This is the "predict early" proof. Report it.
- Proof page shows **dataset metrics and live-room metrics side by side** with the domain-shift disclosure (practice run: 100% on KTH, zero live until retuned).
- Rule-based scorer ships live at 17:00 regardless; classifier swaps in when ready.
- Score any pair of people, not tracked IDs (IDs swap mid-fight).

## Scope
- MUST: live detection · alert card (type, severity, ETA, priority, reason, action, nearest person, alarm) · two-tier alert with Confirm/Dismiss · camera-health tiles · incident log → DB · heatmap + hotspot rule (≥3 same location, same hour-of-week window, within 4 weeks) + **patrol plan** (top-3, expected avoided/week, assumption stated) · **deployed dashboard** with fake 8-week history · proof page incl. held-out **CCTV-domain row** and one **IR frame** · negatives shown on stage (hug, high-five, chat close → green).
- SHOULD (after 23:00 checkpoint): weekly report (one Claude call over SQL) · cornering live · second camera.
- CUT: pgvector / knowledge bank, agent tool loop, staff chat, patrol generator, notification sending, clip storage as a feature, multi-school, auth, dark mode.
- Cut order if behind: SHOULD → second camera → cornering → push card (keep Confirm/Dismiss on the dashboard) → ETA → heatmap to a static image (keep the patrol-plan list). Never cut: live detection, alert card, deployed dashboard, patrol plan list, proof page.
- Web B (Kayla) is scope enforcer at 19:00 and 23:00. The pitch claims only what ran in the 03:00 run-through.

## Checkpoints
14:00 contracts locked, Vercel + Render hello-world opened on a phone, GPU extraction started · **17:00** wave arms in the venue → event appears on the deployed dashboard · **20:00** classifier numbers exist, alert card live · **23:00** full loop on the deployed link (act → alarm → card → heatmap → proof) · 03:00–05:00 run-throughs + record demo video in the venue · 08:00 freeze · **08:30 submit**.

## Contracts (docs/earlyeye-TEAM-FINAL.md §6)
Event record JSON is the one object shared by edge, API, DB and dashboard. If a field must change, change §6 first, in the same commit.

## Git attribution
- **Never add `Co-Authored-By` trailers or "Generated with Claude Code" footers.** `.claude/settings.json` enforces this; this line is the backup.

## Working style
- One branch per screen/module, one PR each, merge often. Rebase onto main before a PR.
- Every dashboard screen must render with the API down (mock fallback).
- Light theme only. Big type on the live screen; a guard reads it from 2 m away.
- Commit hourly. README current: problem, demo link, datasets, metrics (dataset vs live), how to run edge/api/web, privacy notes, limitations.
