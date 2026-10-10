# EarlyEye — Kayla's Plan (Dashboard + Deploy + Pitch)

You own everything the judges see on screen, the deployed link, the slides and the scope cuts. Edge and API hand you the event JSON; you never touch the pose model.

## Stack

| | Choice | Notes |
|---|---|---|
| Framework | **Next.js 15, App Router, TypeScript** | `npx create-next-app@latest web --ts --tailwind --app --src-dir --eslint --no-import-alias` |
| UI | **Tailwind + shadcn/ui** | `npx shadcn@latest init -d` then add: `card badge table button dialog tabs tooltip sheet sonner` |
| Charts | **Recharts** for proof charts; heatmap = plain CSS grid (7 days × 24 hours per location) | don't fight a chart lib for a heatmap |
| Data | `swr` with `refreshInterval: 2000` on the live queue; server fetch elsewhere | polling is enough; Supabase realtime only if free time appears |
| Audio | `/public/alarm.mp3`, played on level change to `fight_likely`/`fight`; needs one user click on the page first (browser autoplay rule) | test in the pitch room |
| Deploy | **Vercel**, env `NEXT_PUBLIC_API_URL` | hello-world live by 14:30 |
| Fallback | `/api/mock/[name]` serves `/public/mock/*.json`; `?replay=1` cycles a canned escalation through the queue | the demo works even if Render is down |

## Repo layout

```
web/
  src/app/
    page.tsx                  live: alert queue + current alert card + camera tiles
    incidents/page.tsx        table of the term's incidents (fake history + live)
    heatmap/page.tsx          location × hour-of-week grid + hotspot list
    proof/page.tsx            metrics, lead time, FA/hour, dataset vs live, model card, disclosure
    api/mock/[name]/route.ts  serves /public/mock/<name>.json
  src/lib/types.ts            contract below
  src/lib/api.ts              getEvents(since), getHotspots(), getProof(), getCameras()
  src/lib/format.ts           MYT time, relative time, level/type colours
  public/mock/events.json, hotspots.json, proof.json, cameras.json, replay.json
  public/alarm.mp3
```

## The contract (locked 14:00; matches docs/earlyeye-TEAM-FINAL.md §6)

```ts
type IncidentType = "fight" | "cornering" | "crowd" | "play";
type Level = "calm" | "tense" | "fight_likely" | "fight";
type Status = "new" | "acknowledged" | "resolved" | "false_alarm";

interface Event {
  incident_id: string; camera_id: string; location: string; zone_type: string;
  start_time: string; end_time: string | null;           // ISO, +08:00
  type: IncidentType; level: Level; peak_score: number;  // 0–1
  eta_seconds: number | null; priority: number;          // 0–1
  reason: string; people_count: number;
  action: string; nearest_staff: string | null;
  status: Status; staff_note: string | null;
}
interface Hotspot { location: string; weekday: number; hour: number; count: number; last_seen: string; }
interface Camera { camera_id: string; location: string; zone_type: string; online: boolean; }
interface Proof {
  datasets: string[]; n_clips: number;
  clip_auc: number; clip_precision: number; clip_recall: number;      // GroupKFold by video
  live_precision?: number; live_recall?: number;                      // on own venue clips
  fa_per_camera_hour: number; own_footage_minutes: number;
  airtlab_fp_rate: number;
  lead_time_s: number[];                                              // per escalation clip
  latency_ms: number;
  model_card: { inputs: string; windows: string; classifier: string; split: string; threshold: string; failure_modes: string[] };
  disclosure: string;                                                 // dataset vs live room; practice-run lesson
  note?: string;                                                      // "placeholder" until real numbers land
}
```

Endpoints: `GET /events?since=<iso>` → `Event[]` · `GET /hotspots` → `Hotspot[]` · `GET /cameras` → `Camera[]` · `GET /proof` → `Proof`.

Write `public/mock/*.json` yourself in the first hour: 5 cameras (hostel corridors, canteen, court), a replayable escalation (12 events: calm → tense → fight_likely eta 6 → fight), a term of ~40 sample incidents, hotspots with "Asrama Puteri L3, Mon–Thu 22:00–23:30" planted, and a proof.json with placeholder numbers marked `note: "placeholder"`.

## Screens (build in this order)

### 1. Live (home) — by 17:00
- Left 60%: **current alert card**, huge: level pill (green / amber / red), type chip, `eta_seconds` as "fight likely in ~6 s" when amber, location, reason sentence, action, nearest staff, two buttons **Acknowledge** / **False alarm** (PATCH status; mock just toggles).
- Right 40%: **queue** sorted by `priority` desc, one row per active incident (level ≥ tense, no end_time), camera tiles below with online dot.
- Red full-width banner + alarm sound at `fight_likely`/`fight`. Tense = amber, silent.
- Font sizes: level ≥ 40px, reason ≥ 20px. A guard reads this from 2 m.
- `?replay=1` runs `replay.json` through the queue at 0.5 s per event so you can demo with no camera.

### 2. Proof — by 20:00 (right after Live; build before heatmap)
- Top: **lead-time strip**: 5 bars, seconds between amber and shove per clip, mean in big type: "Warned 5.8 s before the shove on average."
- Tiles: clip AUC / precision / recall; **false alarms per camera-hour** on N minutes of our own footage; AIRTLab FP rate; latency ms.
- **Dataset vs live** two-column table. Disclosure paragraph verbatim. Model card as a definition list, collapsed.
- `note` renders as a yellow "placeholder numbers" banner until ML deletes it.

### 3. Heatmap + hotspots — by 22:00
- Location selector; grid 7 × 24, cell colour by count, tooltip with count. Hotspot list beside it: "Asrama Puteri L3 · Mon–Thu · 22:00–23:30 · 5 incidents". One line of recommendation under each: "Place a warden here."

### 4. Incidents — by 23:00
- Table: time, camera/location, type, level, priority, status, reason. Filter by type/level. Click → the alert card in a sheet with staff_note editable (mock).

### 5. Swap to real API — 21:00–23:00
- Set `NEXT_PUBLIC_API_URL` to Render. Live queue polls `/events?since=`. Fix shape mismatches with Web A together.

## Your timeline

| Time | Do |
|---|---|
| 14:00–14:30 | Lock the contract. Scaffold, push, **deploy to Vercel, open on your phone on mobile data**. |
| 14:30–15:30 | types, api.ts with mock fallback, mock JSON, alarm.mp3, replay route. |
| 15:30–17:00 | Live screen on mock + `?replay=1`. **17:00 checkpoint:** Model A's rule scorer POSTs to Render → appears on your deployed queue (or replay if API late). |
| 17:00–20:00 | Proof page. Help Model A record venue footage for 20 min (you're the actor; the high mount matters). |
| 20:00–22:00 | Heatmap + hotspots. Slides v1 skeleton (10 slides, §9 of the team plan). |
| 22:00–23:00 | Incidents page. Swap to real API. **23:00 checkpoint:** full loop on the deployed link; apply the cut order if not. |
| 23:00–01:00 | Sleep. |
| 01:00–03:00 | Polish: empty/loading states, alarm audio test, mobile pass (judges open links on phones), favicon, `<title>`. |
| 03:00–05:00 | 3 run-throughs. **Record demo.mp4 in the venue**: negatives → escalation → card → heatmap → proof, dashboard on screen. |
| 05:00–06:00 | Sleep. |
| 06:00–08:00 | Slides final → PDF. README screenshots. Final deploy. Phone test. |
| **08:30** | Submit. |
| 08:30–10:00 | Rehearse 3× timed with the live camera. Test alarm audio in the pitch room. Q&A drill. |

## Rules for yourself
- Light theme only; no animations beyond a 300 ms colour transition on the level pill.
- Every screen renders from mock with the API down. Test it once by stopping the API.
- The live screen is the product. Spend 60% of your time there, 25% on proof, 15% on the rest.
- Don't build: auth, settings, multi-school, dark mode, chat, agent UI, clip player (a static thumbnail is fine).
- Commit every hour. One branch per screen (`web/live`, `web/proof`, `web/heatmap`, `web/incidents`), PR each, squash-merge.

## Demo moments you own (rehearse until boring)
1. Negatives: hug → high-five → chat close, pill stays green. Say nothing; let it sit.
2. Escalation: pill turns amber with "fight likely in ~6 s" **before** the shove, then red + alarm. Pause 2 s on amber.
3. Click the card → heatmap → "Asrama Puteri L3, weeknights after 10 PM" → proof: lead time in big type.
