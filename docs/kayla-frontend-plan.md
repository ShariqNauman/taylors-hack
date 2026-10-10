# EarlyEye — Kayla's Plan (Dashboard + Deploy + Pitch)

You own everything the judges see on screen, the deployed link, the slides and the scope cuts. Edge and API hand you the event JSON; you never touch the pose model.

The dashboard is **site-agnostic**: a campus, a mall, a factory, a school hostel. Nothing in the UI says "school" except the demo site's zone names. Copy uses *site*, *zone*, *operator*, *person on duty*.

## Stack

| | Choice | Notes |
|---|---|---|
| Framework | **Next.js 15, App Router, TypeScript** | `npx create-next-app@latest web --ts --tailwind --app --src-dir --eslint --no-import-alias` |
| UI | **Tailwind + shadcn/ui** | `npx shadcn@latest init -d` then add: `card badge table button dialog tabs tooltip sheet sonner select` |
| Charts | **Recharts** for proof charts; heatmap = CSS grid (7 days × 24 hours per zone) | don't fight a chart lib for a heatmap |
| Data | `swr`, `refreshInterval: 2000` on the live queue; server fetch elsewhere | polling is enough |
| Audio | `/public/alarm.mp3`, played on transition to `fight_likely`/`fight`; needs one click on the page first (autoplay rule) | test in the pitch room |
| Deploy | **Vercel**, env `NEXT_PUBLIC_API_URL` | hello-world live by 14:30 |
| Fallback | `/api/mock/[name]` serves `/public/mock/*.json`; `?replay=1` cycles a canned escalation through the queue | the demo works even if Render is down |

## Repo layout

```
web/
  src/app/
    page.tsx                  live: alert queue + current alert card + camera tiles (with health)
    plan/page.tsx             heatmap + hotspots + PATROL PLAN (the weekly decision screen)
    incidents/page.tsx        table of the history (fake + live), confirm/dismiss labels
    proof/page.tsx            lead time, FA/hour, CCTV-domain row, dataset vs live, IR frame, model card, disclosure
    push/page.tsx             mock phone view of the push card (Confirm / Dismiss), opened via ?incident=
    api/mock/[name]/route.ts  serves /public/mock/<name>.json
  src/lib/types.ts            contract below
  src/lib/api.ts              getEvents(since), getHotspots(), getPatrolPlan(), getProof(), getCameras(), getSite(), patchStatus()
  src/lib/format.ts           MYT time, relative time, level/type colours, zone labels
  public/mock/site.json, cameras.json, events.json, replay.json, hotspots.json, plan.json, proof.json
  public/alarm.mp3, public/ir-frame.jpg
```

## The contract (locked 14:00; matches docs/earlyeye-TEAM-FINAL.md §6)

```ts
type SiteType = "campus" | "school" | "mall" | "factory" | "transit";
type IncidentType = "fight" | "cornering" | "crowd" | "play";
type Level = "calm" | "tense" | "fight_likely" | "fight";
type Status = "new" | "pushed" | "confirmed" | "dismissed" | "resolved";

interface Site { site_id: string; name: string; site_type: SiteType; zones: { zone_type: string; label: string; risk: number }[]; staff: { name: string; zone_type: string; on_duty: boolean }[]; }

interface Camera { camera_id: string; location: string; zone_type: string; online: boolean; last_frame_at: string; black_since?: string; }

interface Event {
  incident_id: string; camera_id: string; location: string; zone_type: string;
  start_time: string; end_time: string | null;           // ISO, +08:00
  type: IncidentType; level: Level; peak_score: number;  // 0–1
  eta_seconds: number | null; priority: number;          // 0–1
  reason: string; people_count: number;
  action: string; nearest_staff: string | null;
  pushed_to?: string; pushed_at?: string;                // two-tier: only fight_likely+ gets pushed; API sets these
  acked_at?: string;                                     // phone tap; response time = acked_at − pushed_at
  status: Status; staff_note: string | null;             // operator sets on Live; edge never overwrites
}

interface Hotspot { location: string; zone_type: string; weekday: number; hour: number; count: number; last_seen: string; }

interface PatrolSlot { location: string; days: string; hours: string; incidents_4w: number; expected_avoided_per_week: number; avoided_per_patrol_hour: number; rationale: string; }
interface PatrolPlan { generated_at: string; slots: PatrolSlot[]; assumption: string; }   // top-3 ranked by expected_avoided_per_week; Block C = 5 × 0.6 / 4 = 0.75/week ("~3 a month"); assumption = "60% of hotspot incidents avoided when a person is present (stated, not measured)"

interface Proof {
  datasets: string[]; n_clips: number;
  clip_auc: number; clip_precision: number; clip_recall: number;         // GroupKFold by video, phone-video sets
  cctv_domain?: { datasets: string[]; auc: number; precision: number; recall: number };  // held-out CCTV-angle sets
  live_precision?: number; live_recall?: number;                         // own venue clips
  fa_per_camera_hour: number; own_footage_minutes: number;
  airtlab_fp_rate: number;
  lead_time_s: number[];                                                 // per escalation clip
  pushes_per_shift_target: number;                                       // 3
  latency_ms: number;
  ir_check: { frames: number; skeletons_detected: number; note: string; image: string };
  model_card: { inputs: string; windows: string; classifier: string; split: string; threshold: string; failure_modes: string[] };
  disclosure: string;                                                    // dataset vs live room; practice-run lesson; what we don't claim
  note?: string;                                                         // "placeholder" until real numbers land
}
```

Endpoints: `GET /site` · `GET /cameras` · `GET /events?since=<iso>` · `PATCH /events/:id {status?, staff_note?, acked_at?}` · `GET /hotspots` · `GET /plan` · `GET /proof`. (`POST /events`, `POST /cameras/heartbeat` are edge → API; the dashboard never calls them.)

Replay rule: `?replay=1` and `replay.json` events are played **by timestamp** (`start_time` deltas), not at a fixed 0.5 s, so "fight likely in ~6 s" is true on screen. `replay.json` therefore needs realistic timestamps: tense at t=0, fight_likely at t≈4 s with eta 6, fight at t≈10 s.

Write `public/mock/*.json` yourself in the first hour. Demo site = **Taylor's Lakeside campus** (`site_type: "campus"`): zones = hostel corridor (risk 1.0), Block C stairwell (0.8), canteen (0.7), car park (0.6), sports court (0.3). 6 cameras, one with `black_since` 3 days ago. `replay.json` = 12-event escalation calm → tense → fight_likely (eta 6) → fight at "Block C stairwell". `events.json` = ~40 incidents over 8 weeks. `hotspots.json` + `plan.json` with the planted pattern "Block C stairwell, Mon–Thu 13:00–14:00, 5 incidents, ~3 avoided/week". `proof.json` with placeholders and `note: "placeholder"`.

## Screens (build in this order)

### 1. Live (home) — by 17:00
- Left 60%: **current alert card**, huge: level pill (green / amber / red), type chip, "fight likely in ~6 s" at amber, location + zone, reason sentence, action, nearest person, **Confirm / Dismiss** buttons (PATCH; mock toggles). Level ≥ 40px, reason ≥ 20px: an operator reads it from 2 m.
- Right 40%: **queue** sorted by `priority`, one row per active incident (level ≥ tense, no end_time); **camera tiles** below with online dot, last-frame time, and a red "black for 3 days" badge on the dead one.
- **Two-tier behaviour:** tense = amber card, silent, no push. fight_likely/fight = red banner + alarm + a toast "Pushed to Guard B" and `pushed_to` filled. Pushes counter in the header: "2 of 3 pushes this shift".
- `?replay=1` runs `replay.json` at 0.5 s/event so you can demo with no camera.

### 2. Proof — by 20:00 (build before Plan; it's the slide the research judge reads)
- Top: **lead-time strip**: 5 bars, mean in big type: "Warned 5.8 s before the shove on average."
- Tiles: clip AUC / precision / recall (phone-video sets) · **CCTV-domain row** (held-out) · **false alarms per camera-hour** on N min of own footage · AIRTLab FP rate · latency.
- **Dataset vs live** two-column table. **IR frame** image with the one-line note. Disclosure paragraph verbatim: what we claim, what we don't. Model card as a definition list, collapsed.
- `note` renders a yellow "placeholder numbers" banner until ML deletes it.

### 3. Plan (heatmap + hotspots + patrol plan) — by 22:00
- **Patrol plan first**, above the fold: three cards, "Place one person at Block C stairwell · Mon–Thu 13:00–14:00 · 5 incidents in 4 weeks · ~3 avoided/week", with the assumption line in small text. This is the Decide screen; make it look like a decision, not a chart.
- Below: zone selector + 7 × 24 heatmap grid, hotspot list beside it.

### 4. Incidents — by 23:00
- Table: time, camera/location, zone, type, level, priority, status (new / pushed / confirmed / dismissed / resolved), reason. Filters. Click → sheet with the card, `staff_note` editable. Confirmed/dismissed counts shown as "labels collected: N" (feeds the false-alarm story).

### 5. Push (duty phone) — MUST, ~45 min, build right after Live
- `/push?staff=Guard%20B`. Two states.
- **Idle:** big button **"I'm on duty"**. The tap (a) plays-and-pauses the alarm to unlock audio, (b) `navigator.wakeLock.request("screen")` so the phone never sleeps, (c) `requestFullscreen()`. Then a calm screen: name, "On duty · 0 pushes this shift", a small camera-health line.
- **Pushed:** swr poll (2 s) finds an event with `pushed_to === staff && status === "pushed" && !acked_at` → whole screen red, card slides in: location (big), type chip, reason, "fight likely in ~N s" if any, 10-s countdown ring, one button **On my way** → `PATCH {acked_at: now}`. Alarm plays, `navigator.vibrate?.([500,200,500,200,800])` (Android only; iOS has no vibration, sound works after the tap). After ack: green "Acknowledged in 4 s", back to idle after 5 s.
- Deep link from a Telegram message (SHOULD) opens the same page already in the pushed state.
- Demo: phone on the table, page open, on-duty tapped before the pitch starts. Wake lock keeps it lit through the 3 minutes.

### 6. Swap to real API — 21:00–23:00
- Set `NEXT_PUBLIC_API_URL`. Live queue polls `/events?since=`. Fix shape mismatches with Web A together.

## Your timeline

| Time | Do |
|---|---|
| 14:00–14:30 | Lock the contract. Scaffold, push, **deploy to Vercel, open on your phone on mobile data**. |
| 14:30–15:30 | types, api.ts with mock fallback, all mock JSON (site, cameras with one dead, replay, events, hotspots, plan, proof), alarm.mp3, ir-frame placeholder. |
| 15:30–17:00 | Live screen on mock + `?replay=1` (by timestamp) + two-tier behaviour + camera health. **17:00 checkpoint:** rule scorer POSTs to Render → appears on the deployed queue (or replay if API late). |
| 17:00–17:45 | `/push` duty-phone page: on-duty tap, wake lock, fullscreen, red takeover, `acked_at`. Test on your real phone over mobile data. |
| 17:45–20:00 | Proof page. Act in the venue footage for 20 min (you're an actor; the high mount matters). |
| 20:00–22:00 | Plan page (patrol cards first, then heatmap). Slides v1 skeleton (10 slides, §9 of the team plan). |
| 22:00–23:00 | Incidents page. Swap to real API. **23:00 checkpoint:** full loop on the deployed link; apply the cut order if not. |
| 23:00–01:00 | Sleep. |
| 01:00–03:00 | Polish: empty/loading states, alarm audio test, mobile pass, favicon, `<title>`, push page if ahead. |
| 03:00–05:00 | 3 run-throughs. **Record demo.mp4 in the venue**: negatives → escalation → card → push → plan → proof, dashboard on screen. |
| 05:00–06:00 | Sleep. |
| 06:00–08:00 | Slides final → PDF. README screenshots. Final deploy. Phone test. |
| **08:30** | Submit. |
| 08:30–10:00 | Rehearse 3× timed with the live camera. Test alarm audio in the pitch room. Q&A drill. |

## Rules for yourself
- Light theme only; no animations beyond a 300 ms colour transition on the level pill.
- Every screen renders from mock with the API down. Test it once by stopping the API.
- Live is the product, Plan is the decision, Proof is the evidence. Time split 50 / 20 / 20 / 10 (incidents + push).
- No school-specific words in the UI chrome. Zone names come from `site.json`.
- Don't build: auth, settings, multi-site switcher, dark mode, chat, agent UI, clip player (static thumbnail is fine), notification sending (the push page is a mock).
- Commit every hour. One branch per screen (`web/live`, `web/proof`, `web/plan`, `web/incidents`), PR each, squash-merge.

## Demo moments you own (rehearse until boring)
1. Negatives: hug → high-five → chat close, pill stays green. Say nothing; let it sit.
2. Escalation: amber + "fight likely in ~6 s" **before** the shove, then red + alarm + "Pushed to Guard B" on the phone in your hand. Pause 2 s on amber.
3. Plan: "Block C stairwell, Mon–Thu lunch, ~3 avoided a week. That's this building." → Proof: lead time in big type, the CCTV-domain row, the IR frame.
