# EarlyEye: System, Users and Journeys — Proposal for Tech Team Approval

**From:** Kayla (Web B) · **Date:** Sat 10 Oct 2026 · **Status:** proposal, needs approval
**Reads with:** `docs/earlyeye-TEAM-FINAL.md` (team plan), `docs/kayla-frontend-plan.md` (frontend plan), `docs/hackathon-brief.md`

This covers how EarlyEye works end to end, who uses it, and each user's path through it. Eight decisions need a yes from the tech team. They are in section 2, with a sign-off checklist at the end.

---

## 1. The system

### What it does

EarlyEye turns the people on existing cameras into skeletons and scores the build-up to a fight. It names the type of incident, ranks it against the other cameras, gives a one-sentence reason, and names one person to send. Every alert becomes a record. Each week, the records become a patrol plan.

### Parts and owners

| Part | Runs on | Owner | Job |
|---|---|---|---|
| Edge app | Venue laptop | Model A, Model B | Camera frames to skeletons, features, score, type, ETA, reason, priority. Posts events. Video never leaves the laptop. |
| Model | GPU, offline | Model B | Classifier, thresholds, proof numbers |
| API | FastAPI on Render | Web A | Stores events, applies the push rule, builds hotspots and the patrol plan, serves proof |
| Database | Supabase Postgres | Web A | Events, cameras, staff, site zones, labels |
| Dashboard | Next.js on Vercel | Web B | Live, Plan, Incidents, Proof, push card. Polls every 2 s. Falls back to mock JSON when the API is down. |
| Weekly report | One Claude call, SHOULD tier | Web A | Writes a summary from SQL results. Never touches detection. |

### One alert, step by step

| # | Where | What happens |
|---|---|---|
| 1 | Edge | YOLO26n-pose turns each frame into skeletons. No faces, no identities, no stored video. |
| 2 | Edge | Every 0.5 s, features over a 1 s window for every pair of people, scaled by torso length. Pairs, not tracked IDs, because IDs swap mid-fight. |
| 3 | Edge | The classifier gives a risk score. Rules on top give the type. The score trend gives the ETA. Top features give the reason sentence. |
| 4 | Edge | The score maps to a level with 1 s persistence: calm, tense, fight likely, fight. Calm is never sent. |
| 5 | Edge | Priority = severity × confidence × zone risk × people count. Zone risk comes from the site table. Nearest person comes from the staff table. |
| 6 | Edge to API | While the level is tense or higher, the edge posts the event every 0.5 s under one incident ID. When the level drops, it sets `end_time`. |
| 7 | API | Upserts by incident ID. On the first `fight_likely`, sets `pushed_to`, `pushed_at` and status `pushed`. |
| 8 | Dashboard | Polls `GET /events?since=` every 2 s. Tense shows silently. Fight likely shows a banner, sounds the alarm, and shows who was pushed. |
| 9 | People | Confirm or Dismiss writes the status. That status is the label. |
| 10 | API, weekly | Hotspot rule: 3 or more incidents in one place, same hour of the week, within 4 weeks. Top 3 become the patrol plan. Avoided = incidents × 0.6, an assumption stated on screen, not a measurement. |
| 11 | Model B | Labels give false alarms per camera-hour and retune each camera's threshold. |

### Two-tier alert rule

- **Tense** stays on the dashboard. No sound, no push.
- **Fight likely and fight** sound the alarm and push one person, never a group.
- **Push budget** is 3 or fewer per site per shift.
- **Threshold** is tuned on our own venue footage for 1 false alarm or fewer per camera-hour.
- **In the hackathon build** the push is a phone web page opened from a link. No SMS or app notification is sent, because notification sending is on the CUT list.

### Endpoints

| Endpoint | Purpose | Status |
|---|---|---|
| `GET /site` | Site name and zone risk table | In frontend plan, not in team plan §6 |
| `GET /cameras` | Cameras with last frame time and `black_since` | In frontend plan, not in team plan §6 |
| `POST /cameras/heartbeat` | Edge reports each camera is alive | **New, see decision 3** |
| `POST /events` | Edge sends an event | Both plans |
| `GET /events?since=` | Dashboard polls new and updated events | Both plans |
| `PATCH /events/:id` | Confirm, Dismiss, resolve, staff note | In frontend plan, not in team plan §6 |
| `GET /hotspots` | Counts by place, weekday and hour | Both plans |
| `GET /plan` | Top 3 patrol slots with the assumption | In frontend plan, not in team plan §6 |
| `GET /proof` | Metrics, lead times, model card, disclosure | Both plans, fields differ |
| `POST /report` | Weekly report, SHOULD tier | Both plans |

### Privacy, in one place

- Only the event record leaves the laptop. No frames, no clips, no faces.
- Dashboard camera tiles show health and level, never a thumbnail.
- A human always decides. The system recommends one action and one person.
- We detect physical aggression and crowding only. We do not claim verbal or online bullying, or night and infrared performance.

Scope (MUST / SHOULD / CUT), rubric mapping and cut order stay as in the team plan §2 and §3.

---

## 2. Decisions to approve

### Decision 1: pick one contract

The team plan §6 and the frontend plan define different event records. The dashboard is already built on the frontend version.

| Field | Team plan §6 | Frontend plan, used by `web/` |
|---|---|---|
| `status` | new, acknowledged, resolved, false_alarm | new, pushed, confirmed, dismissed, resolved |
| `level` | tense, fight_likely, fight | adds calm |
| `pushed_to`, `pushed_at` | missing | present |
| Hotspot `zone_type` | missing | present |
| Proof | auc, precision, recall | clip_auc, cctv_domain row, live precision/recall, ir_check, pushes_per_shift_target, note |
| Endpoints | events, hotspots, proof, report | adds site, cameras, plan, PATCH events |

**Proposal:** adopt the frontend plan version. Update team plan §6 in the same commit, as CLAUDE.md requires.

### Decision 2: the API owns the push

**Proposal:** the API sets `pushed_to` and `pushed_at` on the first `fight_likely` for an incident, and enforces the shift budget. One owner means the dashboard and the phone always agree. The edge never sets push fields.

### Decision 3: add a camera heartbeat

Events only arrive at tense, so the API cannot tell a quiet camera from a black one. "Black for 3 days" is a MUST item.

**Proposal:** every 10 s the edge posts to `POST /cameras/heartbeat`:

```json
{ "camera_id": "CAM-BC-03", "last_frame_at": "2026-10-10T14:31:06+08:00", "black": false }
```

The API updates `last_frame_at`, and sets `black_since` when `black` turns true or heartbeats stop. Demo cameras with no laptop come from seeded rows, one of them with `black_since` 3 days before now.

### Decision 4: fix the patrol plan maths

Five incidents in 4 weeks × 0.6 = 3 avoided per 4 weeks = 0.75 a week. The line "~3 avoided/week" cannot be true, and a judge who checks numbers will catch it.

**Proposal:** say "~3 avoided a month" on stage and on slides. Set `expected_avoided_per_week` to 0.75 in `plan.json` and the API. Update CLAUDE.md and the team plan wording.

### Decision 5: pick the ranking rule

The team plan ranks patrol slots by avoided per patrol hour. With the planted data, that order is:

| Slot | Avoided per week | Patrol hours per week | Avoided per patrol hour |
|---|---|---|---|
| Canteen, east entrance · Fri 12:00–13:00 | 0.45 | 1 | 0.45 |
| Block C stairwell · Mon–Thu 13:00–14:00 | 0.75 | 4 | 0.19 |
| Hostel corridor L3 · Sun–Thu 22:00–23:00 | 0.60 | 5 | 0.12 |

**Proposal:** rank by avoided per week and show avoided per patrol hour beside it. That keeps Block C first and the pitch line intact. The alternative is to keep per-hour ranking and lead the pitch with the canteen.

### Decision 6: settle the CCTV-domain test

CLAUDE.md says train on RLVS + AIRTLab + Surveillance Camera Fight. Team plan §5.6b says train on RLVS + AIRTLab only, and hold out Surveillance Camera Fight + SCVD as the unfamiliar-data test. A dataset cannot be both training data and the held-out test.

**Proposal:** follow §5.6b for the reported CCTV-domain row. If Model B retrains with CCTV sets included, report both rows, as §5.6b already says. Fix the CLAUDE.md line.

### Decision 7: replay at real speed

The dashboard replay runs at 0.5 s per event, but the ETA in `replay.json` drops about 2 s per event. On screen, "fight likely in ~6 s" becomes a fight 1.5 s later.

**Proposal:** replay events by their timestamps. Use the same timing in the dashboard `?replay=1` and in `edge/replay.py` for Phase 2.

### Decision 8: decide who labels

The person on duty gets 10 s and usually cannot see the fight yet, so their Confirm is a weak label. Noisy labels then retune thresholds the wrong way.

**Proposal:** the operator's Confirm or Dismiss on the Live screen is the label. The phone tap becomes "on my way", stored as a new `acked_at` time. `acked_at − pushed_at` also gives response time, which the buyer asks for.

**Alternative:** no new field. Keep the plan as written and accept noisier labels. Response time is then not measurable.

---

## 3. Users and segments

### Segments, in sales order

| # | Segment | Why this order | Status |
|---|---|---|---|
| 1 | Universities and their hostels | 24/7 control room already staffed. Adults, so consent is simpler. Campus owns its IP cameras. Security manager holds an opex budget. | **Beachhead.** Pilot site: Taylor's Lakeside |
| 2 | Private and international day schools | Own budget, reputation, daylight. Often no dedicated control room. | Next |
| 3 | Malls, factories, transit, stadiums | Control room exists. Same engine with a new zone table: loading bays, car parks, queues, platforms. | After schools |
| 4 | Government school hostels | Ministry tenders, vendor-bundled camera sets, infrared at night, warden asleep at 2 AM. 533 sites funded under the RM15k programme. | **Vision slide only.** Night and infrared untested; say so. |

Context we say first, before a judge does: school bullying cases were 7,681 in 2024 and fell to 5,038 in 2025. The ministry audit found 24 of 54 boarding schools with working CCTV.

### Roles inside every site

| Role | Screen | Cadence | Needs | Success measure |
|---|---|---|---|---|
| Desk operator | Live | Seconds, all shift | One alarm, one sentence, one person to send | Time from amber to a person sent |
| Person on duty | Push card | 10 s per push | Where, what, how urgent, one tap | Response time. 3 pushes or fewer per shift. |
| Security manager | Plan, Incidents | Weekly, about 10 min | Patrol plan with its assumption, hotspots, camera health, labels | Incidents avoided per week. No camera black over a day. |
| Buyer | Proof, Plan | At purchase, then quarterly | Privacy story, honest numbers, outcomes | Pilot signed, then renewal |
| Evaluator | Live replay, Proof | Once, about 3 min, no camera | It runs, honest numbers, stated limits | Sees detect, categorize, prioritize and explain in one visit |

The evaluator is a secondary role: hackathon judges, a pilot sponsor, or the IT and privacy reviewer.

### Who plays each role, per segment

| Role | Universities | Day schools | Malls, factories, transit | Government hostels |
|---|---|---|---|---|
| Desk operator | Control-room operator | Gate guard or duty teacher | CCTV operator, 40+ screens | Nobody at night |
| Person on duty | Guard on foot patrol | Duty or discipline teacher | Floor security, auxiliary police | Hostel warden |
| Security manager | Campus security manager | Head of student affairs | Security operations manager | School management |
| Buyer | Head of security or facilities director | Principal and board | Facility or operations director | Ministry, by tender |

For the hackathon we build for universities and the desk operator first. Every other role reuses the same screens. The UI says site, zone, operator and person on duty, never student or school. Zone names come from the site table.

---

## 4. Journeys

Each table shows what the person does, what the system does, and which endpoint or field carries it.

### Desk operator

**Job:** notice the one screen that matters and send the right person before it becomes a fight.
**Context:** control room, 30+ feeds on a wall, reads the dashboard from up to 2 m, 8 to 12 hour shift.

| # | Operator does | System does | Carried by |
|---|---|---|---|
| 1 | Opens Live at shift start and clicks once to allow sound | Loads site, cameras and open incidents | `GET /site`, `GET /cameras`, `GET /events` |
| 2 | Spots a camera black for 3 days and requests a repair | Heartbeat stopped, so `black_since` is set | Camera record, decision 3 |
| 3 | Watches the queue | Ranks active incidents across all cameras | `priority` |
| 4 | Sees a silent amber card: "fight likely in ~12 s". Glances at that feed on the camera wall | Edge posts tense events | `level`, `eta_seconds`, `reason` |
| 5 | Optional: pushes the nearest person early, before red | Sets the push manually | `PATCH /events/:id`, status `pushed` |
| 6 | Sees the red banner, hears the alarm, sees "Pushed to Guard B" | API sets the push on the first `fight_likely` | `pushed_to`, `pushed_at` |
| 7 | Taps Confirm or Dismiss | Saves the label | `PATCH /events/:id` |
| 8 | Adds a one-line note and resolves | Closes the record | `staff_note`, status `resolved`, `end_time` |
| 9 | Hands over: pushes used this shift, cameras still black | Counts pushes this shift | Header counter |

**Pain today:** dead cameras found only when footage is needed. Attention fades after the first hour. Fights are seen after they start. Nobody records whether alerts were right.

### Person on duty

**Job:** get to the right place fast and calm it down.
**Context:** on foot, phone in hand, often tens of metres away, one hand busy.

| # | Person on duty does | System does | Carried by |
|---|---|---|---|
| 1 | Walks the patrol route. Nothing arrives at tense | Two-tier rule holds the push | `level` |
| 2 | Opens the push card on the phone | Card shows one incident: place, type, reason, distance | `/push?incident=`, `GET /events` |
| 3 | Taps Confirm or Dismiss within 10 s | Saves the answer | `PATCH /events/:id`, decision 8 |
| 4 | No answer in 10 s | Desk sees no reply and calls by radio | Needs `acked_at`, decision 8 |
| 5 | Walks to the named place. The name matches site signage | None | Zone label from `GET /site` |
| 6 | Separates the people and tells the desk what happened | Desk writes the note | `staff_note` |
| 7 | Next week, gets a fixed slot at the hotspot | Patrol plan | `GET /plan` |

**Pain today:** vague radio locations. Alerts without context. Too many pings, so they get ignored. Arriving after it is over.

### Security manager

**Job:** turn last month's incidents into this week's roster, and keep every camera working.
**Context:** office desk on Monday, fixed headcount, a roster to fill.

| # | Manager does | System does | Carried by |
|---|---|---|---|
| 1 | Opens Plan on Monday | Builds the plan from the last 4 weeks | `GET /plan` |
| 2 | Reads the top 3 slots: place, days, hours, count, avoided per week, assumption | Hotspot rule plus the 0.6 formula | `slots`, `assumption`, decisions 4 and 5 |
| 3 | Checks one slot against the heatmap | Counts by place, weekday and hour | `GET /hotspots` |
| 4 | Sends a repair request for the black camera | Camera health | `black_since` |
| 5 | Checks which cameras raise false alarms | Confirmed and dismissed counts per camera | `GET /events`, `status` |
| 6 | Asks to retune a noisy camera's zone threshold | Model B retunes from labels | Labels, thresholds |
| 7 | Updates the roster and sends a summary upward | Weekly report, SHOULD tier | `POST /report` |

**Pain today:** patrols follow habit, not data. Reports are counts with no recommendation. Dead cameras found after an incident. Avoided incidents are invisible.

### Buyer

**Job:** approve the spend and the privacy review, then show the board it changed something.
**Context:** answers to a board, parents or a regulator. Compares the cost with one guard post, about RM103k a year, against RM11–27k a year for the software.

| # | Buyer does | System does | Carried by |
|---|---|---|---|
| 1 | Opens the deployed link with no camera attached | Replay and mock fallback keep every screen working | `?replay=1`, `/api/mock/*` |
| 2 | Runs the privacy review with IT | Only the event record leaves the site | Event record |
| 3 | Reads the evidence | Dataset and live numbers side by side, lead time, false alarms per camera-hour, limits | `GET /proof` |
| 4 | Approves a pilot on one building for 4 weeks | One site, its own zone table | `GET /site` |
| 5 | Reviews the pilot | Avoided per week, pushes per shift, labels, response time | `GET /plan`, `GET /events`, decision 8 |
| 6 | Renews or expands at RM45 per camera per month | None | None |

**Pain today:** vendor demos that only run on stage. Video analytics that feel like surveillance. Accuracy numbers with no split and no live test. Security spend with no visible outcome.

### Evaluator

Follows the buyer's steps 1 to 3 in one visit: open the link, watch the replay escalate from calm to fight, then read Proof.

---

## Sign-off checklist

**Status: APPROVED 10 Oct 2026 14:50, with four amendments below.** Applied to `docs/earlyeye-TEAM-FINAL.md` §6, `CLAUDE.md`, `docs/kayla-frontend-plan.md`. Work split in `docs/work-split.md`.

| # | Decision | Proposal | Approved |
|---|---|---|---|
| 1 | Contract | Adopt frontend plan version; update team plan §6 in the same commit | [x] |
| 2 | Push owner | API sets push fields and enforces the shift budget | [x] **Amendment A:** budget caps `fight_likely` only; `fight` always pushes |
| 3 | Camera health | New `POST /cameras/heartbeat` every 10 s | [x] **Amendment B:** `black_since` computed on read (`now − last_frame_at > 60 s`), no scheduler |
| 4 | Patrol maths | "~3 avoided a month"; `expected_avoided_per_week` = 0.75 | [x] |
| 5 | Ranking | Rank by avoided per week; show per patrol hour beside it | [x] |
| 6 | CCTV-domain test | Follow team plan §5.6b; fix CLAUDE.md | [x] |
| 7 | Replay timing | Replay by timestamps, dashboard and `edge/replay.py` | [x] |
| 8 | Labels | Operator labels; phone writes new `acked_at` | [x] |

**Amendment C (write protection):** repeat `POST /events` from the edge never overwrites `pushed_to, pushed_at, acked_at, status, staff_note`.
**Amendment D (staff table):** `GET /site` carries `staff: [{name, zone_type, on_duty}]`; edge fetches it at startup to compute `nearest_staff`. No distance maths.

## Phone pop-out (added after approval)
- **MUST:** `/push?staff=<name>` page. One "I'm on duty" tap unlocks audio, requests a screen wake lock and fullscreen. Page polls every 2 s; on an event with `pushed_to == me && status == pushed` it goes full-screen red, plays the alarm, vibrates (Android), shows a 10-s countdown; one tap writes `acked_at`. The phone must be unlocked with the page open, as a duty phone would be.
- **SHOULD (after 23:00):** Telegram bot message on push with the link to the page; reaches a locked phone with sound. `POST https://api.telegram.org/bot<TOKEN>/sendMessage`, chat IDs collected once via `getUpdates`.
- **Production answer, Q&A only:** PWA + Web Push (VAPID, `pywebpush`); Android full-screen intent in a native wrapper.
