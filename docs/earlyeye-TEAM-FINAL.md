# EarlyEye — Team Final Plan (Dormathon 2026, Track 1)

**Build:** Sat 14:00 → **Sun 08:30 submit** (hard buffer 09:00, deadline 09:30). ~18 hours.
**Submit:** public GitHub · **deployed application link** · slides PDF · team name + branch.
**Pitch:** Phase 1: 3 min + 2 min Q&A, in person. Phase 2 (top 18): 4 min + 3 min Q&A on a **video call**.

Supersedes `EarlyEye_Project_Plan.pdf` (which assumed 33h and a 13:00 submit) and folds in `EarlyEye_Market_Competitor_Financial_Plan.md`. Rubric is verbatim in `docs/hackathon-brief.md`.

---

## 1. One paragraph

> **EarlyEye: bullying and violence early warning for Malaysian school hostels, on the cameras they already own.**
> A pose model watches body movement (skeletons, never faces). A classifier scores the *build-up*, not just the fight, and says what kind of incident it is, how urgent, why, and who to send. Every alert becomes a record; over a term the heatmap tells the warden where and when to stand. Video never leaves the school.

**Users:** (live) the guard/warden at the screen: one alarm, one sentence, one action. (weekly) the discipline teacher: heatmap + hotspot list. (buyer) school management.

**Framing, said once:** "The government is putting CCTV in 533 hostels at RM15k a set. In the ministry's own audit, only 24 of 54 boarding schools had cameras that worked, and nobody watches them at 11 PM. We make the camera watch itself."

**Say before a judge does:** cases rose 3,883 → 7,681 (2022–24) and **fell to 5,038 in 2025**. Use "7,681 cases in 2024, over 70% in secondary schools"; don't say "rising."

---

## 2. Rubric mapping (the judges' words)

| Judges require | EarlyEye |
|---|---|
| **Detect** | Per-second risk score from pose features; **time-to-incident** from the rising trend ("fight likely in ~6 s") |
| **Categorize** (what *type*, not just abnormal) | Four **types**, not severity levels: **Fight** (two-party strikes) · **Cornering / bullying** (1 vs 3+, >5 s) · **Crowd gathering** (ring forming) · **Play / sports** (benign, suppressed in sports zones). Severity (tense → fight likely → fight) is a second axis |
| **Prioritize** | `priority = severity × confidence × zone_risk × people_count`; zone_risk is highest for hostel corridors at night. Alert queue across cameras sorted by priority; cost exposure shown ("hostel night incident: high") |
| **Explain** | One sentence from the top features: "wrist speed spiked; distance dropped below 0.5 torso-lengths for 1.2 s" + recommended action + nearest warden |
| **Decide** | Action table per level; weekly hotspot list → "place a warden at Asrama Puteri L3, Mon–Thu 22:00–23:30" |
| **Prove it** | Video-level GroupKFold metrics on public clips · **false alarms per camera-hour** on our own normal footage · AIRTLab hard negatives · **early-warning lead time** (seconds between amber and the shove) on our own escalation clips · latency ms/frame |
| Minimize false alarms | "Tense" is silent; alarm only at fight-likely+; 1-s persistence; sports-zone threshold; false-alarms/camera-day is the headline metric |
| Robust on unfamiliar data | Train on public clips, **report live-room numbers separately** (our practice run showed the gap; we show it, not hide it) |
| Measurable impact | Guard-post cost RM103k/yr vs RM11–27k/yr software; enrolment break-even 0.55 student/yr (market doc) |

---

## 3. Scope

### MUST (by Sat 23:00)
1. **Live detection**: webcam/phone → YOLO-pose + tracking → window features → classifier + rules → level, type, score, ETA, reason, action
2. **Alert card** on the dashboard: camera, location, type, severity, ETA, reason, action, nearest warden; alarm sound + red banner at fight-likely+
3. **Incident log**: every alert → a record (contract in §6) → database
4. **Heatmap + hotspots** over a fake term of 300–500 incidents (2–3 planted patterns), hotspot rule: ≥3 incidents, same location, same hour-of-week window, within 4 weeks
5. **Deployed dashboard** (Vercel) reading the database: live alert queue, incident list, heatmap, proof page. The camera laptop POSTs events to it. The judge opens the URL and sees the alert appear.
6. **Proof page**: dataset metrics (video-level split), false alarms/camera-hour on own footage, AIRTLab negatives, lead-time on 5 escalation clips, latency, model card, **domain-shift disclosure**
7. **Negatives shown on stage**: hug, high-five, chat close → green

### SHOULD (only after 23:00 checkpoint)
8. **Weekly report**: one Claude call over SQL results (counts, hotspots, trend) → BM/EN report with incident IDs cited. No vector DB, no agent loop.
9. Cornering type with live demo (1 vs 3 actors)
10. Second camera (phone via DroidCam) to show cross-camera priority queue

### CUT (do not build; one closing-slide line each)
pgvector / knowledge bank · agent tool loop / staff chat · patrol-plan generator · notification sending · clip storage as a feature (just dump last 10 s locally) · multi-school · auth

**Cut order if behind at 23:00:** SHOULD → second camera → cornering → heatmap down to a static image → ETA (keep level + reason). Never cut: live detection, alert card, deployed dashboard, proof page.

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
7. **ETA:** moving-average score, linear fit over last 3 s, extrapolate to threshold. Report **lead time** on 5 escalation clips: seconds between amber and the shove. This is the "predict early" proof.
8. **Domain-shift disclosure:** proof page shows dataset metrics and live-room metrics side by side. The practice run (100% on KTH, zero live until retuned) goes on the model card as a known failure mode and what we did about it.
9. Save `model.pkl`, `thresholds.json`, `proof.json`; numbers to Pitch by **20:00**.

**Fallback at 18:00 if the classifier isn't trained:** rule-based scorer (wrist speed > 3 torso/s toward someone < 1 torso away for > 1 s) ships live; classifier swaps in later or is reported as "trained, not yet deployed live."

---

## 6. Contracts (lock at 14:00)

**Event record** (`POST /events`, one per alert; also the DB row):
```json
{ "incident_id": "INC-2026-00142", "camera_id": "CAM-ASR-03", "location": "Asrama Puteri, koridor tingkat 3",
  "zone_type": "hostel_corridor", "start_time": "2026-10-11T22:41:07+08:00", "end_time": null,
  "type": "fight|cornering|crowd|play", "level": "tense|fight_likely|fight", "peak_score": 0.87,
  "eta_seconds": 6, "priority": 0.92, "reason": "wrist speed spiked; distance below 0.5 torso",
  "people_count": 3, "action": "Send nearest warden (Warden B, ~40 m)", "nearest_staff": "Warden B",
  "status": "new|acknowledged|resolved|false_alarm", "staff_note": null }
```
**Live alert** (same object, pushed every 0.5 s while level ≥ tense; dashboard polls `GET /events?since=`).
**Hotspot** (`GET /hotspots`): `{ location, weekday, hour, count, last_seen }[]`.
**Proof** (`GET /proof`): `{ datasets, n_clips, auc, precision, recall, fa_per_camera_hour, airtlab_fp_rate, lead_time_s: number[], latency_ms, model_card, disclosure }`.

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
| 0:00–0:20 | Hook: hostel corridor at night | "RM8 million of CCTV going into 533 hostels. The ministry's own audit found most don't work and nobody's watching at 11 PM. EarlyEye makes the camera watch itself." |
| 0:20–0:40 | Problem: 7,681 cases in 2024, >70% secondary; new Penal Code s.507 (Jul 2025); hostels at night | "Cameras today are for the police report afterwards." |
| 0:40–0:55 | What it is: camera → skeleton → risk → type → priority → action → heatmap | "Skeletons, never faces. Video never leaves the school." |
| 0:55–2:05 | **Live** (deployed dashboard on screen, phone camera mounted high, two actors in the taped zone): negatives first (hug, high-five, chat close → green) → escalation (talk → step closer → arms up → fake shove): amber **before** the shove, "fight likely in ~6 s", red + alarm → alert card: type, priority, reason, "send Warden B" → heatmap: "Asrama Puteri L3, weeknights after 10 PM" | pause 2 s at amber. That's the product. |
| 2:05–2:30 | Proof: video-level split metrics; **lead time on our 5 escalations**; false alarms/camera-hour on 30 min of our own footage; AIRTLab negatives; dataset vs live-room numbers side by side | "We show both numbers because the gap is the real engineering problem." |
| 2:30–2:50 | Business: RM45/camera/month on existing CCTV; guard post RM103k/yr vs RM11–27k; 533 government hostels + 348 international schools; Hikvision/Dahua give an alarm, we give a type, a priority, a reason and a plan | |
| 2:50–3:00 | Next: cornering/bullying type live, multi-camera, pilot with one boarding school, weekly warden report | |

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
| What about the Zara Qairina case? | "The inquest is ongoing; we don't claim we'd have prevented it. It showed the gap: hostel, night, no witnesses, nobody watching." |
| Deployed link? | "The dashboard is live at [URL] with a term of incident history and the proof page; the camera at the venue is posting to it right now." |

---

## 11. Business (one slide; from the market doc, all "illustrative")

- **Buyers:** private/international/boarding schools (own budget, reputation) → government hostel programme (533 sites, ~RM15k/set already funded) → universities, hostels → later malls/transit.
- **Price:** RM45/camera/month on existing CCTV + setup. 40 cameras ≈ RM1,800/month. 66% below Volt AI (~RM132), 34% below Verkada's licence alone.
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
