# EarlyEye — Team Final Plan (Dormathon 2026, Track 1)

**Build:** Sat 14:00 → **Sun 08:30 submit** (hard buffer 09:00, deadline 09:30). ~18 hours.
**Submit:** public GitHub · **deployed application link** · slides PDF · team name + branch.
**Pitch:** Phase 1: 3 min + 2 min Q&A, in person. Phase 2 (top 18): 4 min + 3 min Q&A on a **video call**.

Supersedes `EarlyEye_Project_Plan.pdf` (which assumed 33h and a 13:00 submit) and folds in `EarlyEye_Market_Competitor_Financial_Plan.md`. Rubric is verbatim in `docs/hackathon-brief.md`.

---

## 1. One paragraph

> **EarlyEye: physical-aggression early warning for any site that already has cameras and a security desk.** Campuses and hostels, schools, malls, factories, transit.
> A pose model watches body movement (skeletons, never faces). A classifier scores the *build-up*, not just the fight, and says what kind of incident it is, how urgent, why, and who to send. Every alert becomes a record; over weeks the heatmap turns into a **patrol plan**: where to put one person, when, and how many incidents that avoids. Video never leaves the site.

**Claim discipline:** we detect *physical* aggression and crowding. We do **not** claim to detect verbal or online bullying; say on stage: "We catch the physical part; the heatmap shows where the rest clusters." Use "bullying" only for the school segment's weekly layer.

**Users (same product, every site type):** (live) the control-room operator / guard: one alarm, one sentence, one action. (weekly) the security or site manager: heatmap, hotspots, patrol plan, camera health. (buyer) management: incidents avoided, staff hours, duty-of-care evidence.

**Segments, in sales order:** 1) **universities + their hostels** (adults, 24/7 control room already staffed, campus owns IP cameras, security manager has opex: *pilot at Taylor's Lakeside*) → 2) private/international schools, daytime campuses → 3) malls, factories, transit, stadiums (same engine, different zone thresholds) → 4) government school hostels via the RM15k programme, once IR/night numbers exist. School hostels are the **vision slide**, not the first customer.

**Framing, said once:** "One operator watches 30 screens. Malaysia's own school audit found most hostel cameras don't even work, and nobody is watching the ones that do. We make the camera watch itself, and tell the one person on duty where to go."

**Say before a judge does:** cases rose 3,883 → 7,681 (2022–24) and **fell to 5,038 in 2025**. Use "7,681 cases in 2024, over 70% in secondary schools"; don't say "rising."

---

## 2. Rubric mapping (the judges' words)

| Judges require | EarlyEye |
|---|---|
| **Detect** | Per-second risk score from pose features; **time-to-incident** from the rising trend ("fight likely in ~6 s") |
| **Categorize** (what *type*, not just abnormal) | Four **types**, not severity levels: **Fight** (two-party strikes) · **Cornering / bullying** (1 vs 3+, >5 s) · **Crowd gathering** (ring forming) · **Play / sports** (benign, suppressed in sports zones). Severity (tense → fight likely → fight) is a second axis |
| **Prioritize** | `priority = severity × confidence × zone_risk × people_count`; `zone_risk` comes from a per-site zone table (hostel corridor at night = 1.0, canteen at recess = 0.7, sports court = 0.3, car park = 0.6). Queue across cameras sorted by priority. Weekly: hotspots ranked by **expected incidents avoided per patrol hour** |
| **Explain** | One sentence from the top features: "wrist speed spiked; distance dropped below 0.5 torso-lengths for 1.2 s" + recommended action + nearest warden |
| **Decide** | Live: action table per level, one named person to send. Weekly: **patrol plan** = top-3 hotspots → "Place one guard at Block C stairwell, Mon–Thu 13:00–14:00: 5 incidents in 4 weeks, ~3 avoided/week." Ranked by incidents per patrol hour. This is the decision product; the alarm is the sale |
| **Prove it** | Video-level GroupKFold metrics on public clips · **false alarms per camera-hour** on our own normal footage · AIRTLab hard negatives · **early-warning lead time** (seconds between amber and the shove) on our own escalation clips · latency ms/frame |
| Minimize false alarms | **Two-tier alerting:** tense → dashboard only, silent. fight_likely/fight → alarm + push to *one* nearest person, with a 10-second **Confirm / Dismiss** that becomes a label. Target ≤3 pushes per site per shift; say the number. 1-s persistence; zone thresholds; false-alarms/camera-hour is the headline metric |
| Robust on unfamiliar data | Train on phone-video clips (RLVS, AIRTLab); **hold out the CCTV-angle sets (Surveillance Camera Fight, SCVD) as a separate domain test** and report that row. Then live-room numbers. Night/IR: one real IR frame on a slide showing what the pose model does with it; "next step", not a claim |
| Measurable impact | Guard-post cost RM103k/yr vs RM11–27k/yr software; enrolment break-even 0.55 student/yr (market doc) |

---

## 3. Scope

### MUST (by Sat 23:00)
1. **Live detection**: webcam/phone → YOLO-pose + tracking → window features → classifier + rules → level, type, score, ETA, reason, action
2. **Alert card** on the dashboard: camera, location, type, severity, ETA, reason, action, nearest warden; alarm sound + red banner at fight-likely+
3. **Incident log**: every alert → a record (contract in §6) → database
4. **Heatmap + hotspots + patrol plan** over a fake 8-week history of 300–500 incidents (2–3 planted patterns), hotspot rule: ≥3 incidents, same location, same hour-of-week window, within 4 weeks. Patrol plan = top-3 hotspots with "place one person here, these hours" and expected incidents avoided/week (= hotspot rate × 0.6, assumption stated). SQL + one formula; no model.
4b. **Camera health** on the camera tiles: online dot, last frame time, "black for 3 days" badge. Trivial, and the reason the dashboard stays open on a quiet week.
4c. **Two-tier alert**: tense silent on the dashboard; fight_likely+ triggers alarm + a push card to the nearest person (mock phone view or `wa.me` link) with Confirm / Dismiss; the tap writes `status` and a label row.
5. **Deployed dashboard** (Vercel) reading the database: live alert queue, incident list, heatmap, proof page. The camera laptop POSTs events to it. The judge opens the URL and sees the alert appear.
6. **Proof page**: dataset metrics (video-level split), false alarms/camera-hour on own footage, AIRTLab negatives, lead-time on 5 escalation clips, latency, model card, **domain-shift disclosure**
7. **Negatives shown on stage**: hug, high-five, chat close → green

### SHOULD (only after 23:00 checkpoint)
8. **Weekly report**: one Claude call over SQL results (counts, hotspots, trend) → BM/EN report with incident IDs cited. No vector DB, no agent loop.
9. Cornering type with live demo (1 vs 3 actors)
10. Second camera (phone via DroidCam) to show cross-camera priority queue

### CUT (do not build; one closing-slide line each)
pgvector / knowledge bank · agent tool loop / staff chat · patrol-plan generator · notification sending · clip storage as a feature (just dump last 10 s locally) · multi-school · auth

**Cut order if behind at 23:00:** SHOULD → second camera → cornering → push card (keep Confirm/Dismiss on the dashboard) → ETA (keep level + reason) → heatmap to a static image (keep the patrol-plan list). Never cut: live detection, alert card, deployed dashboard, patrol plan list, proof page.

---

## 4. Tech stack

```
Laptop at venue (edge)                      Cloud                               Judges
webcam/phone ─► YOLO26n-pose + tracking     FastAPI on Render  ◄─ POST /events  Next.js on Vercel
             ─► features (1 s, stride 0.5)  Supabase Postgres (free)            live queue · heatmap
             ─► LightGBM/RF + rules         Claude (SHOULD: weekly report)      proof page
             ─► POST event JSON ──────────►                                     ◄─ polling 2 s / Supabase realtime
Video never leaves the laptop. Only the event record goes up.
```

| Layer | Choice | Why |
|---|---|---|
| Pose | Ultralytics YOLO26n-pose + built-in tracker, OpenCV | pretrained, ~40 ms/frame CPU, proven in the practice run |
| Features + classifier | Python, numpy/pandas, scikit-learn RandomForest **or** LightGBM, joblib | trains in minutes, feature importances → reason sentence |
| Keypoint extraction | GPU: Grafilab credits or Colab, resumable script | CPU overheated a laptop in practice |
| Edge app | `edge/run.py`: capture → score → draw skeletons → POST event | one process, one window for the split-screen demo |
| Backend | FastAPI on Render: `POST /events`, `GET /events`, `GET /hotspots`, `GET /proof`, (SHOULD) `POST /report` | same language as the model |
| Database | Supabase Postgres (free tier) | hosted, realtime optional, zero ops. SQLite fallback for local |
| Frontend | Next.js 15 + Tailwind + shadcn + Recharts on Vercel | deployed link from hour one; heatmap = CSS grid |
| LLM | Claude `claude-sonnet-5-5` (SHOULD only, weekly report) | reads SQL output, never touches detection |
| Repo | `edge/ api/ web/ model/ data/ slides/`, public by 08:00 | |

**Deployed-link rule:** the Vercel dashboard must be useful *without* a camera: fake term history, heatmap, proof page, and the last live events. A judge opening it alone should understand the product.

---

## 5. Model plan (Model B, with Model A on extraction)

1. **Datasets:** Real Life Violence Situations (1k/1k), AIRTLab (hard negatives: hugs, claps), Surveillance Camera Fight (CCTV angle). RWF-2000 withdrawn; don't cite it as used.
2. **Extraction (start at 14:00, on GPU):** YOLO26s-pose over clips → keypoints only → `data/keypoints/*.npz`. Resumable; test on 20 clips first. If GPU credits fail: nano model on CPU over a 300-clip subset.
3. **Features per 1-s window** (stride 0.5 s, scaled by torso length, most-extreme pair): max wrist/elbow speed, wrist jerk, min torso distance + rate, arm extension toward other torso, limb-to-body intersections, facing angle, motion variance, people within 2 torso-lengths.
4. **Classifier:** RF (200 trees, balanced) or LightGBM. **GroupKFold by video**, never by window. Report precision/recall/AUC at clip level (max window score per clip). Calibrate.
5. **Type head:** rule-based on top of score: fight (2 parties, strikes) · cornering (1 vs ≥3 within 2 torso-lengths, >5 s) · crowd (≥5 within 3 torso-lengths, low motion) · play/sports (zone = sports **or** rhythmic motion variance). Document as rules; don't call it a model.
6. **Threshold:** tune on **our own normal footage** (30 min of chatting/walking/hugs in the venue) for ≤1 false alarm per camera-hour. Report the number.
6b. **Domain test:** train on RLVS + AIRTLab only; test on Surveillance Camera Fight + SCVD (CCTV angle) as a held-out domain. Report clip AUC/precision/recall for that row separately. If it's bad, it's still the most honest "unfamiliar data" number in the room; then retrain with CCTV sets included and report both.
6c. **IR check (15 min):** run the pose model on 3 IR/greyscale CCTV frames (any public night-CCTV still). Screenshot the skeletons or the failure. One slide: "night works / night needs an IR-trained model". No claims beyond the screenshot.
7. **ETA:** moving-average score, linear fit over last 3 s, extrapolate to threshold. Report **lead time** on 5 escalation clips: seconds between amber and the shove. This is the "predict early" proof.
8. **Domain-shift disclosure:** proof page shows dataset metrics and live-room metrics side by side. The practice run (100% on KTH, zero live until retuned) goes on the model card as a known failure mode and what we did about it.
9. Save `model.pkl`, `thresholds.json`, `proof.json`; numbers to Pitch by **20:00**.

**Fallback at 18:00 if the classifier isn't trained:** rule-based scorer (wrist speed > 3 torso/s toward someone < 1 torso away for > 1 s) ships live; classifier swaps in later or is reported as "trained, not yet deployed live."

---

## 6. Contracts (lock at 14:00)

**Approved 10 Oct 14:50 per `docs/earlyeye-system-proposal.md` (decisions 1–8 + amendments).** The TypeScript definitions in `docs/kayla-frontend-plan.md` are the single source of truth; this section is the JSON view.

**Event record** (`POST /events` from the edge, every 0.5 s while level ≥ tense, same `incident_id`; also the DB row):
```json
{ "incident_id": "INC-2026-00142", "camera_id": "CAM-BC-03", "location": "Block C stairwell",
  "zone_type": "stairwell", "start_time": "2026-10-11T13:41:07+08:00", "end_time": null,
  "type": "fight|cornering|crowd|play", "level": "calm|tense|fight_likely|fight", "peak_score": 0.87,
  "eta_seconds": 6, "priority": 0.92, "reason": "wrist speed spiked; distance below 0.5 torso",
  "people_count": 3, "action": "Send Guard B", "nearest_staff": "Guard B",
  "pushed_to": null, "pushed_at": null, "acked_at": null,
  "status": "new|pushed|confirmed|dismissed|resolved", "staff_note": null }
```
Edge may set everything **except** `pushed_to, pushed_at, acked_at, status, staff_note`; the API ignores those from the edge and never lets a repeat post overwrite them. `calm` is never posted; it only appears in replay data.

**Push rule (API):** on the first `fight_likely` or `fight` for an incident → set `pushed_to = nearest_staff`, `pushed_at = now`, `status = pushed`. Shift budget = 3 pushes per 8-hour window; **the budget caps `fight_likely` only, `fight` always pushes.** Operator may push early via `PATCH` (status `pushed`).

**Heartbeat** (`POST /cameras/heartbeat`, every 10 s from the edge): `{ camera_id, last_frame_at, black: false }`. `black_since` is computed on read: `now − last_frame_at > 60 s` or `black: true`. Seeded demo cameras without a laptop carry fixed values; one is black 3 days.

**v3 optional additions (10 Oct design handoff; the dashboard renders without them):** Event `snapshot` and `peak_snapshot` = `{ t, people: [{ id, kp: [[x, y, conf] × 12] }] }`, x and y normalised 0–1, the 12 body keypoints only (no face points). Event `top_features` = `[{ name, value }]`. Heartbeat may add `people_count`, `edge_url` (that camera's edge process: `/health`, `/stream.mjpg`, `/clips/<incident_id>.mp4`) and `source` (`live` or `recorded`) with `recorded_at`; Camera returns them, and the dashboard uses `edge_url` only in the on-site view. Cameras: **1 live webcam** (`CAM-AU-01`, the auditorium, demo laptop), **4 labelled recordings** of our own staged clips played through the same edge pipeline, and `CAM-HC-02` seeded black. Camera `geo: { lat, lng, alt_m?, building?, floor? }`, `staff[].post: { lat, lng }` and Site `campus: { center, buildings }` place everything on the 3D model of the real Taylor's Lakeside campus (`design/assets/taylors-lakeside-campus.geojson`, © OpenStreetMap contributors, ODbL; `design/assets/campus-3d-seed.json`).

**Site** (`GET /site`): `{ site_id, name, site_type, zones: [{zone_type, label, risk}], staff: [{name, zone_type, on_duty}] }`. Edge fetches this at startup for `zone_risk` and `nearest_staff` (the on-duty person assigned to that zone, else the first on duty).

**Labels / ack** (`PATCH /events/:id`): operator on Live sends `status: confirmed|dismissed|resolved` (+ `staff_note`); the phone sends `acked_at` only. Response time = `acked_at − pushed_at`.

**Hotspot** (`GET /hotspots`): `{ location, zone_type, weekday, hour, count, last_seen }[]`.
**Patrol plan** (`GET /plan`): `{ generated_at, slots: [{ location, days, hours, incidents_4w, expected_avoided_per_week, avoided_per_patrol_hour, rationale }], assumption }`. Rule: ≥3 incidents, same location, same hour-of-week window, within 4 weeks. `expected_avoided_per_week = incidents_4w × 0.6 / 4` (Block C: 5 → 0.75/week, say "~3 a month"). **Rank by avoided per week**; show per-patrol-hour beside it.
**Proof** (`GET /proof`): as `Proof` in the frontend plan: `clip_*` (phone-video sets, GroupKFold by video), `cctv_domain` (held-out SCF + SCVD), `live_*`, `fa_per_camera_hour`, `airtlab_fp_rate`, `lead_time_s[]`, `pushes_per_shift_target`, `latency_ms`, `ir_check`, `model_card`, `disclosure`, `note`.
**Replay** (`edge/replay.py` and dashboard `?replay=1`): events are replayed **by their timestamps**, not at a fixed interval, so ETA on screen matches wall-clock.

---

## 7. Roles

| Role | Owns | Hand-offs |
|---|---|---|
| **Model A (vision)** | camera input, YOLO pose + tracking, keypoint extraction on GPU, skeleton overlay, live feature log, `edge/run.py` event POST | keypoints per frame by 16:00 · live skeletons 15:00 |
| **Model B (ML)** | features, classifier, GroupKFold, type rules, threshold on own footage, ETA, reason sentence, `proof.json` | rule scorer live 17:00 · classifier 20:00 · proof 22:00 |
| **Web A (backend + data)** | FastAPI on Render, Supabase schema, fake term history (300–500 incidents, planted patterns), hotspot query, camera/staff config, (SHOULD) weekly report | API on Render 15:30 · fake history 17:00 |
| **Web B (frontend + pitch, Kayla)** | Next.js on Vercel from 14:30, live queue, alert card, heatmap, proof page, slides, demo script, backup video, **scope enforcer at 19:00/23:00** | screens on mock 19:00 · live events 21:00 · slides v1 23:00 |

Everyone at 14:00: lock the contracts; deploy hello-world to Vercel + Render; open both on a phone on mobile data; start keypoint extraction.

---

## 8. Timeline

| Time | Goal | Checkpoint |
|---|---|---|
| **14:00–14:30** | contracts, repo, Vercel + Render hello-world, extraction started | both URLs open on a phone |
| **14:30–17:00** | A: skeletons live · B: features on first keypoints, rule scorer · Web A: API + fake history · Web B: dashboard on mock | **17:00:** wave arms in the venue → event appears on the **deployed** dashboard (rule-based is fine) |
| **17:00–20:00** | B: train + validate, threshold on own footage · A: record 30 min normal + 5 escalations + hugs/high-fives in venue lighting, high mount · Web A: hotspots · Web B: alert card + heatmap | **20:00:** classifier numbers exist; alert card live |
| **20:00–23:00** | B: ETA + lead-time + type rules + proof.json · Web B: proof page, swap mock → API · Pitch: slides v1 | **23:00:** full loop on the deployed link: act → alarm → card → heatmap → proof. If not → cut order, no debate |
| **23:00–03:00** | sleep in shifts (2 awake): SHOULD items or bug fixes | |
| **03:00–05:00** | 3 full run-throughs · **record demo video in the venue** (escalation + negatives + dashboard) | |
| **05:00–06:00** | sleep | |
| **06:00–08:00** | slides → PDF · README · repo public · final deploy · phone test | |
| **08:30** | **Submit. Freeze.** | |
| **08:30–10:00** | rehearse 3× timed with the live demo · Q&A drill · test alarm audio in the pitch room | |

---

## 9. Demo (3:00) and Phase 2

| Time | Slide | Say |
|---|---|---|
| 0:00–0:20 | Hook: a control-room wall of 30 screens | "One person, thirty screens. Malaysia's own school audit found most hostel cameras don't even work, and nobody watches the ones that do. EarlyEye makes the camera watch itself, on any site: campus, mall, factory, hostel." |
| 0:20–0:40 | Problem: 7,681 cases in 2024, >70% secondary; new Penal Code s.507 (Jul 2025); hostels at night | "Cameras today are for the police report afterwards." |
| 0:40–0:55 | What it is: camera → skeleton → risk → type → priority → action → heatmap | "Skeletons, never faces. Video never leaves the school." |
| 0:55–2:05 | **Live** (deployed dashboard on screen, phone camera mounted high, two actors in the taped zone): negatives first (hug, high-five, chat close → green) → escalation (talk → step closer → arms up → fake shove): amber **before** the shove, "fight likely in ~6 s", red + alarm → alert card: type, priority, reason, "send Warden B" → heatmap: "Asrama Puteri L3, weeknights after 10 PM" | pause 2 s at amber. That's the product. |
| 2:05–2:30 | Proof: video-level split metrics; **lead time on our 5 escalations**; false alarms/camera-hour on 30 min of our own footage; AIRTLab negatives; dataset vs live-room numbers side by side | "We show both numbers because the gap is the real engineering problem." |
| 2:30–2:50 | Business: one engine, every site with cameras and a desk. First customer: university campuses and hostels (24/7 control room, adults, opex budget) → private schools → malls/factories/transit → government hostels (533 sites funded). RM45/camera/month private, per-site inside the RM15k government set. Guard post RM103k/yr vs RM11–27k. Hikvision/Dahua give an alarm; we give a type, a priority, a reason, a person to send, and a patrol plan. | "Pilot: this campus. Block C stairwell." |
| 2:50–3:00 | Next: IR/night model (show the IR frame), cornering live, multi-camera, Taylor's Lakeside pilot | |

**Phase 2 (video call):** do **not** act live over a call. Screen-share: 60-second recorded escalation video (venue lighting) + the live deployed dashboard receiving the recorded events replayed by a script (`edge/replay.py`). Same alarm, zero lighting risk.

**Backup for Phase 1:** `demo.mp4` on a slide, one click. If the pose model stutters, switch within 5 seconds; don't apologise twice.

---

## 10. Q&A (15-second answers)

| Q | A |
|---|---|
| Isn't this just if/else rules? | "The score is a classifier trained on public violence clips, video-level split, numbers on the proof page. Rules name the *type* and write the sentence so a guard trusts it." |
| Hikvision/Dahua already do this in the government sets | "They raise a crowd alarm after the fact, on their hardware. We score the build-up, name the type, rank across cameras, explain, and run on any RTSP camera. We checked their K-12 material; there's no early warning and no explanation." |
| Cases dropped in 2025 | "Yes, 5,038 in government schools. Reporting changes may explain part of it; the ministry still funded 333 more hostel CCTV sites for 2026. The gap we solve is cameras nobody watches." |
| Surveillance of children? / PDPA | "No faces, no identities, nothing but the event record leaves the site, clips auto-delete, a human always decides. PDPA still applies to CCTV; minimal data makes the school's review easier." |
| False alarms? | "Tense is silent. Alarm needs multiple signals for over a second. We measured X false alarms per camera-hour on 30 minutes of our own normal footage and tested on AIRTLab's hugs and claps." |
| Accuracy? | "Precision X / recall Y on a video-level split. Live-room numbers are lower and we show them; the practice run taught us a dataset score says nothing about your camera." |
| Why would a school pay? | "One guard post costs ~RM103k a year and can't watch 40 screens. 40 cameras cost ~RM27k. For a private school, one retained student pays for it." |
| Most bullying isn't physical. | "Correct, and we don't claim it. We catch the physical part in real time; the heatmap shows where everything clusters so a person is there. For the rest you need counsellors, not cameras." |
| Why not hostels at night first? | "Because the warden is asleep and the camera is IR. We start where there's a 24/7 control room and daylight: campuses, malls, factories. Here's what the pose model does on an IR frame today (slide). Night is the next model, not a claim." |
| Does it work at night / on IR? | "Untested beyond this frame. We say so. Daytime CCTV angles: here's the held-out CCTV-domain row." |
| Alert fatigue? | "Tense never pings anyone. Fight-likely pings one person with a 10-second confirm. Target: three pushes per site per shift, and every tap is a label that retunes that camera." |
| Why would a mall or factory care? | "Same engine, different zones: loading bays, car parks, queues. Fights, crowding, and someone cornered look the same to a skeleton. The control room is already there; we rank its screens." |
| What about the Zara Qairina case? | "The inquest is ongoing; we don't claim we'd have prevented it. It showed the gap: hostel, night, no witnesses, nobody watching." |
| Deployed link? | "The dashboard is live at [URL] with a term of incident history and the proof page; the camera at the venue is posting to it right now." |

---

## 11. Business (one slide; from the market doc, all "illustrative")

- **Buyers, in order:** 1) universities and their hostels (24/7 control room, adults, security manager with opex, campus-owned IP cameras; pilot at Taylor's Lakeside) → 2) private/international day schools (own budget, reputation) → 3) malls, factories, transit, stadiums (same engine, zone thresholds differ; control room exists) → 4) government school hostels via the RM15k programme (533 sites funded) once IR numbers and a pilot exist.
- **Why not schools first:** ministry tenders, vendor-bundled analytics in the RM15k sets, IR night footage, and the warden is asleep at 2 AM. Keep it as the vision.
- **Price:** RM45/camera/month on existing CCTV + setup for private sites; **per-site** pricing inside the RM15k government set. 40 cameras ≈ RM1,800/month. 66% below Volt AI (~RM132), 34% below Verkada's licence alone.
- **Wedge feature:** camera health. The audit found 24 of 54 boarding schools with working CCTV. "This camera has been black for 3 days" is boring, sellable, and keeps the dashboard open.
- **Serviceable market:** ~881 sites, ~RM12.1M/yr at full penetration (illustrative).
- **Unit economics:** hardware is a real cost (edge box ~RM2k per 4 streams, unbenchmarked); 17–26 month payback on subscription alone, 6–10 months with a setup fee.
- **Moat:** every confirmed/dismissed alert is a labelled sample from that school; skeleton-only design is easier to approve for children.
- **Headline metric for pilots:** false alarms per camera-day, response time, staff hours.

---

## 12. Risks

| Risk | Backup |
|---|---|
| Extraction too slow / GPU credits fail | 300-clip subset on CPU nano; rule-based scorer ships live regardless |
| Classifier underperforms live (domain shift) | blend model + rule score; tune on own clips; report both numbers |
| False alarm during the live demo | negatives rehearsed 10×; sports-zone threshold off; "tense" silent; if it fires, say "that's the tense level, silent by design" |
| Venue lighting / slow laptop | nano model; phone camera mounted high; demo video recorded in the venue |
| Render cold start when the camera POSTs | edge app retries; dashboard also accepts a local JSON replay |
| Pose IDs swap mid-fight | score any pair, not tracked IDs |
| Scope creep (agent, vector DB) | CUT list; Web B enforces at 19:00/23:00 |
| Over-claiming | pitch describes only what ran in the 03:00 run-through |

---

## 13. Submission checklist
- [ ] Vercel dashboard opens on mobile data with fake history + proof page; camera events visible when the laptop is on
- [ ] Repo public; README: problem, demo link, datasets used (and that RWF-2000 was not), metrics (dataset vs live), how to run edge + api + web, privacy notes, limitations
- [ ] No secrets in repo (`grep -r sk-ant`; Supabase service key only in Render env)
- [ ] Slides PDF; `demo.mp4` in repo and on a slide
- [ ] Team name + Taylor's branch
- [ ] Submitted by **08:30**
