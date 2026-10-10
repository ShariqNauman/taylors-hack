# EarlyEye — Work Split: Backend (Web A) vs Frontend (Kayla, Web B)

Approved plan = `docs/earlyeye-system-proposal.md` (decisions 1–8 + amendments A–D) + `docs/earlyeye-TEAM-FINAL.md` + `docs/kayla-frontend-plan.md`. Contract source of truth = the TypeScript in the frontend plan; §6 of the team plan is its JSON view. Model A/B (edge + model) are in team plan §5/§7; this file is only the two web roles.

## 0. How this maps to the judging (so nobody builds the wrong thing)

| Rubric line | Built by | Where the judge sees it |
|---|---|---|
| **Detect** | Model A/B (score, ETA) | Live card: level pill, "fight likely in ~6 s" |
| **Categorize** | Model B (type rules) | Live card type chip; Incidents filter |
| **Prioritize** | Edge (priority) + **Backend** (`/plan` ranking) | Live queue order; Plan cards ranked by avoided/week |
| **Explain** | Model B (reason) + **Frontend** (layout) | Reason sentence ≥20px on card and phone |
| Supports decision, not just prediction | **Backend** (push rule, plan) + **Frontend** (push page, plan page) | Phone goes red → "On my way"; Monday patrol plan |
| Minimize false alarms | **Backend** (two-tier, budget) + Model B (threshold) | Tense silent; "N of 3 pushes this shift"; FA/camera-hour on Proof |
| Robust on unfamiliar data | Model B (CCTV-domain row, IR check) + **Frontend** (Proof page) | Proof: dataset vs live, CCTV row, IR frame |
| Measurable impact, realistic assumptions | **Backend** (plan maths, response time) + **Frontend** (shows assumption) | Plan: "0.75/week, assumption stated"; Incidents: response time |
| Clear user | **Frontend** (operator / duty / manager screens) | Three roles, three screens, one rule |
| **Prove it** | Model B numbers + **Frontend** Proof page | Lead time, FA/hour, CCTV row, disclosure |
| Deployed link | **Frontend** (Vercel) + **Backend** (Render) | The URL on the submission form |

## 1. Backend (Web A): FastAPI on Render + Supabase

Order matters. Each item has an acceptance test; don't move on until it passes.

| # | By | Task | Acceptance |
|---|---|---|---|
| B1 | 14:30 | Render hello-world: `GET /health` → `{ok:true}`. CORS open for the Vercel domain and localhost. | URL opens on a phone |
| B2 | 15:00 | Supabase schema: `events` (all Event fields, PK `incident_id`), `cameras` (`camera_id, location, zone_type, last_frame_at, black_flag`), `site` (one row, JSON zones + staff), `labels` view (confirmed/dismissed per camera). SQLite fallback via env flag if Supabase misbehaves. | tables exist; seed script runs idempotently |
| B3 | 15:30 | `GET /site` from seed: Taylor's Lakeside; zones hostel corridor 1.0 / Block C stairwell 0.8 / canteen 0.7 / car park 0.6 / sports court 0.3; staff Guard A (canteen), Guard B (stairwell), Guard C (hostel), Warden D (hostel, off duty). | matches `Site` type |
| B4 | 15:45 | `GET /cameras`: 6 seeded cameras; `black_since` **computed on read** (`now − last_frame_at > 60 s` or flag) — one seeded 3 days old. `POST /cameras/heartbeat {camera_id, last_frame_at, black}` upserts. | heartbeat flips `black_since` to null within 10 s |
| B5 | 16:30 | `POST /events`: upsert by `incident_id`. Edge may set every field **except** `pushed_to, pushed_at, acked_at, status, staff_note` (ignore if present). On first `fight_likely`/`fight`: set `pushed_to = nearest_staff`, `pushed_at = now`, `status = pushed`. Shift budget: count `pushed_at` in the current 8-h window; **budget caps `fight_likely` only, `fight` always pushes**. Set `end_time` when the edge posts it. | repeat posts never clear a Confirm; 4th fight_likely in a shift is not pushed; a fight is |
| B6 | 16:45 | `GET /events?since=<iso>`: returns events created **or updated** after `since` (keep an `updated_at`); default last 24 h; sorted by `priority` desc. | dashboard sees status changes made by the phone |
| B7 | 17:00 | `PATCH /events/:id {status?, staff_note?, acked_at?}`: operator fields and phone `acked_at`. Reject edge-only fields. | phone ack visible on Live within 2 s |
| **17:00** | | **Checkpoint:** Model A's rule scorer posts a real event → appears on the deployed dashboard. | |
| B8 | 18:30 | Fake 8-week history generator: 300–500 incidents, planted: Block C stairwell Mon–Thu 13:00–14:00 (5 in 4 w), canteen east Fri 12:00 (3), hostel corridor L3 Sun–Thu 22:00 (4). Mixed types, ~30% dismissed. Seed `confirmed/dismissed` so Incidents shows labels. | `/events?since=<8w ago>` returns it |
| B9 | 19:30 | `GET /hotspots`: group by location × weekday × hour over 4 weeks. `GET /plan`: hotspot rule (≥3 same location, same hour window, within 4 w) → `expected_avoided_per_week = incidents_4w × 0.6 / 4`, `avoided_per_patrol_hour = that / patrol hours/week`, **rank by avoided/week**, top 3, `assumption` string verbatim from the proposal. | Block C first with 0.75/week; canteen shows higher per-hour beside it |
| B10 | 20:30 | `GET /proof`: serves `model/proof.json` from Model B (fallback: placeholder with `note: "placeholder"`). Adds `pushes_per_shift_target: 3` and a computed `median_response_s` from `acked_at − pushed_at`. | matches `Proof` type |
| B11 | 21:00 | `edge/replay.py` (with Model A): replays a recorded event sequence to `POST /events` **by timestamps**. Used for Phase 2 and for rehearsal without actors. | ETA on dashboard matches wall clock |
| **23:00** | | **Checkpoint:** full loop on the deployed link: act → event → alarm → push page red → ack → status on Live → Plan → Proof. | |
| B12 | SHOULD, after 23:00 | Telegram push: on `status = pushed`, `sendMessage` to the staff's chat id with the `/push?staff=` link. Env `TELEGRAM_TOKEN`, `STAFF_CHAT_IDS` JSON. Fail silently. | locked phone buzzes within 2 s |
| B13 | SHOULD | `POST /report`: one Claude call over `/hotspots` + counts → BM/EN weekly summary citing incident IDs. | returns text |
| B14 | 06:00 | README "how to run api", env list, seed command. Secrets only in Render env. `grep -r sk-ant` before public. | |

Backend does **not** build: auth, websockets, notification services beyond Telegram, vector DB, agent loops, clip storage.

## 2. Frontend (Kayla, Web B): Next.js on Vercel

Full detail in `docs/kayla-frontend-plan.md`. Order and acceptance:

| # | By | Task | Acceptance |
|---|---|---|---|
| F1 | 14:30 | Scaffold, deploy hello-world to Vercel, open on phone over mobile data. | URL on the group chat |
| F2 | 15:30 | `types.ts` (contract), `api.ts` with mock fallback, `/api/mock/[name]`, all mock JSON incl. `replay.json` with real timestamps, `alarm.mp3`, `ir-frame.jpg` placeholder. | every page renders with API down |
| F3 | 17:00 | **Live**: alert card (≥40px level pill, type chip, ETA, reason ≥20px, action, nearest, Confirm/Dismiss), priority queue, camera tiles with health badge, two-tier banner + alarm, pushes counter, `?replay=1` by timestamp. | replay shows amber before red, alarm fires once |
| F4 | 17:45 | **Push** duty-phone page: "I'm on duty" tap (audio unlock, wake lock, fullscreen), poll, red takeover + sound + vibrate, 10-s ring, "On my way" → `PATCH acked_at`. | tested on your real phone over mobile data |
| F5 | 20:00 | **Proof**: lead-time strip first, tiles (clip AUC/P/R, CCTV-domain row, FA/camera-hour, AIRTLab FP, latency), dataset-vs-live table, IR frame, disclosure, model card collapsed, placeholder banner. | reads `/proof` or mock |
| F6 | 22:00 | **Plan**: three patrol cards above the fold (avoided/week big, per-hour small, assumption line), zone selector + 7×24 heatmap, hotspot list. | Block C first, "~3 a month" wording |
| F7 | 23:00 | **Incidents**: table, filters, sheet with note; "labels collected: N"; response-time column from `acked_at − pushed_at`. Swap `NEXT_PUBLIC_API_URL` to Render; fix mismatches with Web A. | full loop on deployed link |
| F8 | 03:00 | Polish, mobile pass, alarm audio test in the pitch room, `demo.mp4` recorded in the venue with the phone in frame. | |
| F9 | 06:00 | Slides → PDF (10 slides per team plan §9), README screenshots, final deploy, phone test. | |
| F10 | 08:30 | Submit. Then rehearse 3×, Q&A drill. | |

Frontend does **not** build: auth, settings, multi-site, dark mode, chat, agent UI, clip player, real notifications (the phone page + Telegram link is the notification).

## 3. Shared rules

- Contract changes: edit `docs/kayla-frontend-plan.md` types **and** team plan §6 in the same commit, then tell the other person. No silent field renames.
- Branch per task (`api/events`, `web/live`, …), PR, squash-merge to `main`. Rebase before PR. No Co-Authored-By trailers.
- Every screen must work with the API down; every endpoint must work with no edge attached (seeded data).
- Scope enforcer at 19:00 and 23:00 is Kayla. Cut order is in the team plan §3. The pitch claims only what ran in the 03:00 run-through.

## 4. Integration tests (run together at 17:00 and 23:00)

1. Edge posts tense → Live shows amber, silent, phone shows nothing.
2. Edge posts fight_likely → API sets push → Live red + alarm + "Pushed to Guard B" → phone red + sound within 2 s → tap → `acked_at` → Live shows "ack 4 s".
3. Operator Confirm → status persists through the next edge post.
4. 4th fight_likely in the shift → not pushed; a `fight` → pushed.
5. Stop heartbeat for 60 s → camera tile goes "black".
6. `/plan` → Block C first, 0.75/week; `/proof` → placeholder banner until Model B's JSON lands.
7. Kill the API → every dashboard page still renders from mock; `?replay=1` still escalates by timestamp.
