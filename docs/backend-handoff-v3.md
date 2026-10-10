# Backend handoff v3: what the current frontend needs

For Web A (backend) and the edge owner. Written Sat 10 Oct 2026, 23:00, from the code on branch **`web/integration`**. That branch merges all the frontend work with `api/live-loop`, `api/plan-guard` and `api/camera-zone`.

**In one line:** the frontend is built and runs on mock data. For the demo and the deployed link to be real, the API that Render deploys must serve the routes below, and the edge must post live updates.

---

## 0. Do this first: the deployed API has none of the new backend work

- `render.yaml` line 9 deploys branch **`backend`**, last updated about 8 hours ago.
- `api/live-loop`, `api/plan-guard` and `api/camera-zone` are **not** in it. So the live API:
  - rejects the guard's "On my way" (`acked_at`);
  - has no guard-post routes;
  - only inserts events, so it can't update them.

Steps:
1. Merge into `backend`, in this order: `api/live-loop`, then `api/plan-guard`, then `api/camera-zone`. They merge cleanly together; `web/integration` already has all three.
2. In Supabase, run `api/sql/migration_live_loop.sql`, then `api/sql/migration_plan_guard.sql`. Until you do, the new fields are dropped silently and the API still answers 200.
3. **Pick one seed.** `api/seed/seed_site.py` and the plan-guard migration conflict:
   - together they create "Guard B" and "Guard C" twice;
   - `seed_site.py` deletes the auditorium zone.

   Keep the migration's people and cameras, because they match the frontend:
   - **People:** Guard A (Tan Wei Jie), Guard B (Aiman Hakimi), Guard C (Priya Nair), Warden D (Rosnah Ahmad).
   - **Cameras:** CAM-AU-01 (live webcam, Grand Hall), CAM-BC-03, CAM-CT-04, CAM-HC-01, CAM-HC-02 (black), CAM-SC-06.
4. Render env, all `sync: false`, never committed:
   - `ANTHROPIC_API_KEY`;
   - `ANTHROPIC_MODEL=claude-sonnet-5-5` (the code defaults to "claude-sonnet-5", which is wrong);
   - `CORS_ORIGINS`: the Vercel domain, `http://localhost:3000` and `http://localhost:3010`.
5. Then tell Kayla. On Vercel she will set `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_API_RESOURCES=events,site,cameras,plan,hotspots,proof`. Until then the dashboard reads only `events` from the API and everything else from its own mock data.

Check it worked:
```bash
curl -s $API/plan | head -c 300
curl -s -X PATCH $API/events/INC-TEST -H 'Content-Type: application/json' -d '{"acked_at":"2026-10-10T23:00:00+08:00"}'
```
The first must return slots with `id`, `status` and `assigned_to`. The second must store `acked_at`, not drop it.

---

## 1. How the frontend talks to the API

- **Client:** `web/src/lib/api.ts`. **Types:** `web/src/lib/types.ts`. Those types are the contract: same field names, ISO times with `+08:00`.
- **Base URL:** `NEXT_PUBLIC_API_URL`.
- **Which reads use the API:** `NEXT_PUBLIC_API_RESOURCES` (default `events`). Anything else, or anything that takes over 4 s, falls back to `/api/mock/*`.
- **Polling:** every 2 s. Live, the guard app and Plan poll `GET /events?since=` and `GET /plan`.
- **Reference implementation:** `web/src/app/api/mock/*` and `web/src/lib/server/*` implement the same rules over a shared file store. `web/src/lib/plan-rules.ts` holds the post rules and is shared by the mock and the client. When in doubt, match their behaviour.

---

## 2. Every route the frontend calls

| # | Route | Used by | Body / returns | State on `web/integration` |
|---|---|---|---|---|
| 1 | `GET /site` | every page | `Site`: zones, and `staff[]` with `name` (call sign), `display_name`, `photo_url`, `role`, `zone_type`, `shift {label, days, from "HH:MM", to}`, `on_duty`, `post {lat,lng}`; plus `campus {center, buildings}` | **Partial.** No `post`, no `campus`; `on_duty` is NULL for every row |
| 2 | `PATCH /staff/:name` `{on_duty}` | guard app: Start / End my shift | returns the staff row | **Missing.** The app falls back to its local store, so the desk never sees who's on duty |
| 3 | `GET /cameras` | Live, Cameras, 3D | `Camera[]` with `source` (`live`/`recorded`), `recorded_at`, `edge_url`, `people_count`, `geo`, `black_since` | **Partial.** Only id, location, zone, online, last_frame_at, black_since |
| 4 | `POST /cameras/heartbeat` (edge → API) | camera health | `{camera_id, people_count, edge_url, source, recorded_at}` every 10 s. Sets `last_frame_at`. `black_since` is computed on read. | **Missing.** CAM-HC-02 never shows "black for 3 days" from the API. Use a threshold of about 60 s, not 5 min. |
| 5 | `PATCH /cameras/:id` `{zone_type}` | Track record: "Make it a sports zone" | returns the camera | **Done** in `api/camera-zone`. Also filter the zones lookup by site, and use the camera's zone when scoring priority (today the edge's own priority wins). |
| 6 | `GET /events?since=` | Live, Incidents, Track record, guard app | `Event[]` | **Partial.** Must filter by **`updated_at > since`**, not `start_time`, and return `updated_at`. Without `since`, return the last 28 days, not the latest 50: Track record counts 4 weeks and the seed has 350+ events. |
| 7 | `POST /events` (edge → API) | live loop | upsert by `incident_id` | **Done** in `api/live-loop`. Keeps the human fields (status, staff_note, acked_at, arrived_at, outcome). Add a row lock or `ON CONFLICT` so two near-simultaneous posts can't both push. |
| 8 | `PATCH /events/:id` | Live (Confirm / Dismiss / Undo / Push now), guard app, Incidents | `StatusPatch {status, staff_note, acked_at, arrived_at, outcome, outcome_at}` | **Done**, except one gap. When the desk presses **Push now**, the frontend will send `{status:"pushed", pushed_to, pushed_at}` (being added on `web/finish`). Accept and store `pushed_to` and `pushed_at`; today they are dropped, so no phone rings. |
| 9 | `GET /plan` | Plan, guard app (Today / Schedule) | `PatrolPlan {generated_at, last_check, slots[]}`. Slots have `id, status, since, assigned_to, seen_at, tip, suggestion, ended_at, evidence, checkins[], location, days, hours, incidents_4w, expected_avoided_per_week, rationale, zone_type` | **Done** in `api/plan-guard`. `tip` is never written; seed one per post. `avoided_per_patrol_hour` is optional (the frontend computes it). |
| 10 | `PATCH /plan/slots/:id` `{status, assigned_to, seen_at}` | Plan (Add, Not now, End, Send, Change), guard app (Got it) | the slot | **Done** in `api/plan-guard` |
| 11 | `POST /plan/slots/:id/checkins` `{staff}` | guard app: "I'm at my post" | the slot | **Done** in `api/plan-guard` |
| 12 | Daily 06:00 check | Plan suggestion card | over the last 28 days: 3+ real incidents at the same place and hour become `status:"suggested"`; a post quiet for 14 days gets `suggestion:"end"`; it never changes an active post | **Logic done, not scheduled.** It only runs lazily on the first `GET /plan` after 06:00, and two polls can race to the same new id (500). Schedule it (Render cron or a startup task) and guard it with a lock. |
| 13 | `GET /hotspots` | Plan statistics | `Hotspot[]` | **Done** |
| 14 | `GET /proof` | Track record | `Proof` (see `types.ts`): dataset metrics from `model/proof.json`, including `clip_recall`, `cctv_domain`, `ir_check {image}`, `model_card`, `disclosure` | **Done for dataset numbers.** Live numbers (alarms real vs false, by camera, by week, reply times) are computed by the frontend from `GET /events`, so route 6 must return 28 days. |
| 15 | `POST /handover` `{facts: HandoverFacts}` | Live: End shift → "Write the brief" | `HandoverBrief {text, model, generated_at}` | **Missing.** Optional; the mock template works. If built: one Claude call with `claude-sonnet-5-5`, wording only the facts sent. No raw events, no invented numbers. |
| 16 | `GET /replay` | Live demo replay | `Event[]` | **Not needed.** The replay is mock-only. Phase 2 uses `edge/replay.py` posting to `POST /events`. |
| 17 | `POST /report` | (weekly brief, optional) | — | **Fix if kept.** Wrong default model name, ignores `period`, and returns invented numbers ("5.8 s", "Asrama Puteri") when the call fails. Return an error instead. |
| 18 | `POST /plan/slots` | Plan: "+ Add a post" | `{location, zone_type, geo {lat,lng}, days, hours, tip, assigned_to, source:"manual"}` → the new slot, with `status:"active"` and `since: now` | **Missing.** New. |
| 19 | `PATCH /plan/slots/:id`, extended | Plan: "Edit" | also accepts `days`, `hours`, `location`, `zone_type`, `geo`, `tip`. Return `source` (`"model"` or `"manual"`) on every slot. If the guard is no longer free at the new time, still save, but clear `seen_at` so the app shows "Changed by your supervisor". | **Missing.** Today it takes only status, assigned_to and seen_at. |
| 20 | `PATCH /cameras/:id` `{sensitivity}` | Track record: "Apply" on "What EarlyEye suggests changing" | `sensitivity` is `"strict"` or `"sensitive"`, the model team's two presets in `model/live_detector.py`. `GET /cameras` returns it; default `"strict"`. | **Missing.** The camera-zone route takes only zone_type. |
| 21 | `GET /labels?since=` | model team (not the dashboard) | one row per decided incident: `incident_id, camera_id, start_time, level, peak_score, status, outcome, peak_snapshot` (keypoints only, never video) | **Missing.** New. A CSV export script is fine instead. |

---

## 3. Rules the screens depend on

1. **Two tiers.**
   - `tense` never pushes.
   - `fight_likely` and `fight` push to one person.
   - `fight_likely` is capped at 3 pushes per shift; `fight` always pushes.
   - Count the budget per shift, not over a rolling 8 hours.
2. **Who gets the push:** the nearest staff member who is **on duty** (`staff.on_duty`, set by route 2), using the zone or post distance. Not the edge's fixed `--staff` value. If nobody is on duty, set `nearest_staff` and leave `pushed_to` empty. The desk can still Push now.
3. **Human fields are never overwritten by the edge:** `status`, `staff_note`, `acked_at`, `arrived_at`, `outcome`, `outcome_at`, `pushed_to`, `pushed_at`.
4. **Calm after the guard.** When the edge reports the incident ended (`end_time`) or calm again, keep the event and return it with `end_time` and its last level. Live shows "Sorted · camera agrees: calm" only when it can see that.
5. **Times:** ISO 8601 with `+08:00`. `outcome` is one of `sorted | hurt | backup | nothing`.
6. **Manual posts follow the same rules as model posts.** They count for "Did the posts work?". After 14 quiet days the daily check suggests ending them (`suggestion:"end"`), never ending them on its own. A model suggestion answered "Not now" comes back only after 3 new incidents (already in `plan_logic.py`).
7. **Nearest guard is where people are now.** A guard with a check-in on an active post during its hours counts as standing at that post. Otherwise use their `post` geo. Use this for `nearest_staff` and the push (rule 2).
8. **The guard's "Nothing there" is a hint, not a label.** Store `outcome:"nothing"`; never change `status` from it. The desk still decides Confirm or Dismiss.
9. **Writes are open in the pilot,** with no auth: PUT /proof, PATCH events, plan and cameras. Say so in the README limitations. Don't add auth tonight.

---

## 4. Edge (for the edge owner)

- **Post live updates.** `edge/run_all.py` never passes `--upsert`, so each incident is posted once at the first FIGHT: no tense, no snapshot updates, no end. Turn on `--upsert` for the live webcam (CAM-AU-01) and post every 0.5 s while an incident is open. Recordings run with `--no-post`; turn posting on for them too, with `source:"recorded"`.
- **Send `fight_likely` with `eta_seconds`,** not just tense or fight. Without it the push budget and the "Fight likely in ~N s" card never happen live.
- **Send the end.** Set `end_time` when the scene is calm for 5 s, so the desk can show "camera agrees: calm".
- **Heartbeat** (route 4) every 10 s per camera. Have the heartbeat response return `{zone_type, sensitivity}` so a change from Track record takes effect within 10 s.
- **Per-camera sensitivity.** Switch `FIGHT_AT` per camera between the existing `"strict"` and `"sensitive"` presets (`model/live_detector.py`), instead of the one global `SENSITIVITY`.
- **Keep the keypoints for training.** Save each incident's keypoint windows (no video) with its `incident_id`, so the model team can join them with route 21 and retrain weekly.
- **Leave `nearest_staff` empty,** so the API picks the nearest on-duty person (rule 2).
- `GET /clips/<id>.mp4` is a 404 stub. The Incidents "Watch the 10-second clip" button needs it on site. It's optional if time is short; the screen falls back to stick figures.
- `GET /live.json`, `/stream.mjpg` and `/health` are used by the on-site view. Keep them.

---

## 5. Full-loop check before judging

With the API deployed and Vercel pointed at it:

1. Wave or stage a shove at the live webcam. Within 2 s, Live shows the alert card and the alarm.
2. Guard B's phone (`/guard`) rings within 2 s. Tap On my way → I'm here → Sorted, nobody hurt.
3. Live's card shows Alerted · On the way · There · Sorted, then "camera agrees: calm".
4. The desk taps Confirm. Incidents shows the case with the guard's steps in the timeline.
5. Plan: assign Wei Jie to post 3. His phone shows "New from your supervisor"; he taps Got it, and Plan shows "Seen in the app".
6. Track record's counts go up by one real alarm.
7. Plan: "+ Add a post" at the sports pitch, Tue 17:00. It appears on the map, in the timetable, and in the chosen guard's app as "Changed by your supervisor". Edit its hour, and the app updates again.
8. Track record: Apply "Make this camera stricter" on the sports pitch. `GET /cameras` returns `sensitivity:"strict"`, and the edge log shows the new preset within 10 s.

If any step needs the mock to pass, it is not done.

---

## 6. Order for tonight

1. **P0:** section 0, the merge, migrations, seed and env. Then route 8 (`pushed_to` / `pushed_at` on Push now) and route 6 (`updated_at`, 28 days).
2. **P0, edge:** `--upsert`, `fight_likely` with ETA, and end/calm.
3. **P1:** route 2 (on duty) and rule 2 (push to the nearest on-duty guard); route 4 (heartbeat) and route 3's camera fields.
4. **P1:** schedule the 06:00 check (route 12) with a lock.
5. **P1:** routes 18 and 19 (add and edit posts) and rules 6 and 7.
6. **P1, with the edge owner:** route 20 plus per-camera `FIGHT_AT` on the edge. Skip it if the edge owner has no time; the frontend then keeps the setting on the dashboard with "Saved on this computer".
7. **P2:** route 21 (labels), route 15 (handover), route 17 fixes, the clips endpoint, `tip` seed.
