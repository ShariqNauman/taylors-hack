# Backend plan: guard posts + guard app (PR #28)

For the backend team. The web side (Plan page, `/guard` app) already works without this, on the local
demo store. This plan makes the laptop, the guard's phone and the deployed dashboard share one
database.

## What PR #28 adds (branch `api/plan-guard`, based on `api/live-loop` #18)

| Route | Body | Used by |
|---|---|---|
| `GET /site` | (none). Now returns `staff[]`: `name` (call sign), `display_name`, `photo_url`, `role`, `zone_type`, `shift {label, days[0=Mon], from, to}` | Plan "Who is going?", guard app "Who is using this phone?" |
| `GET /plan` | (none). Posts with `id, status (active/suggested), since, assigned_to, seen_at, tip, suggestion, evidence[], checkins[]`, plus `last_check` | Plan page, guard app Today/Schedule |
| `POST /plan/recheck` | (none). Runs the daily check now | demo, cron |
| `PATCH /plan/slots/{id}` | `{status}` / `{assigned_to}` (null = nobody) / `{seen_at}` | Plan: Add this post, Not now, End this post, pick a guard. Guard app: opened the post |
| `POST /plan/slots/{id}/checkins` | `{staff, at?}` | Guard app: "I'm at my post" |
| `PATCH /events/{id}` | adds `arrived_at`, `outcome` (sorted/hurt/backup/nothing), `outcome_at` | Guard app: I'm here, What did you find? |
| `PATCH /staff/{name}` | `{on_duty}` | Guard app: Start my shift / End my shift. Off duty = no alarms |
| `POST /events/{id}/backup` | `{staff?, reason: need_backup / no_answer}` | Desk: Send Priya. Creates `<id>-B` pushed to that guard or the next on duty |

**Real-incident rules in `POST /events`:**
- **The alarm only goes to someone on duty.** It goes to the edge's `nearest_staff` if they're on duty; otherwise to someone on duty in that zone; otherwise to anyone on duty. If nobody is on duty, it still goes to the edge's choice. A guard who never tapped Start my shift (`on_duty` null) counts as on duty, so nobody is skipped silently.
- **No answer in 20 s:** if the guard hasn't tapped "On my way" 20 s after the push and the edge is still posting, the API pushes `<id>-B` to the next guard on duty, once per incident.
- **A repeat edge post never overwrites the guard's taps:** `acked_at`, `arrived_at`, `outcome` and `outcome_at` are human fields.

Rules (pure, tested in `api/services/plan_logic.py` / `api/test_plan_logic.py`):
- **Active posts:** the recheck never ends them, moves them or reassigns them.
- **Daily check:** at 06:00 Malaysia time, it looks at the last 28 days. A place and hour with 3 or more confirmed or resolved incidents becomes a `suggested` post. An active post with none in 14 days gets `suggestion: "end"`.
- **Ended posts:** a post that was ended, or a suggestion answered "Not now", comes back only after 3 *newer* incidents.
- **Changing the guard** clears `seen_at`.

## Steps, in order (about 20 minutes)

1. **Merge #18** (`api/live-loop`), then **#28**. #28 is based on #18; GitHub retargets it to `main` once #18 merges.
2. **Supabase SQL editor:** run `api/sql/migration_live_loop.sql`, if that isn't done yet, then `api/sql/migration_plan_guard.sql`. Both are safe to re-run. The second one:
   - adds the staff columns and the 4-person demo team (Guard A/B/C, Warden D, with names, photos and shifts);
   - adds the event columns `arrived_at`, `outcome` and `outcome_at`;
   - creates `plan_slots`, `plan_checkins` and `plan_meta`.
3. **Render:** redeploy (auto on merge to `main`, if that's set up). No new env vars.
4. **Seed the posts.** The first `GET /plan` seeds P1–P3 from hotspots and runs today's check. Since the hotspot seed data is the old Asrama set, set the demo posts explicitly so the deployed plan matches the mock:
   ```sql
   -- optional: make the deployed plan match web/public/mock/plan.json
   DELETE FROM plan_slots; DELETE FROM plan_meta;
   INSERT INTO plan_slots (id, location, zone_type, days, hours, incidents_4w, expected_avoided_per_week, rationale, status, since, assigned_to, tip) VALUES
    ('P1','Block C stairwell','stairwell','Mon–Thu','13:00–14:00',5,0.75,'5 incidents in the same lunch hour, Monday to Thursday, in 4 weeks.','active','2026-10-05T09:12:00+08:00','Guard B','Stand at the level 1 landing; you see both flights.'),
    ('P2','U Residence, corridor L3','hostel_corridor','Sun–Thu','22:00–23:00',4,0.6,'4 incidents after 22:00 in 4 weeks.','active','2026-10-04T08:40:00+08:00','Guard C','Walk L3 end to end; the L5 camera is off.'),
    ('P3','Syopz Mall food court','canteen','Fri','12:00–13:00',3,0.45,'3 crowd gatherings at Friday lunch in 4 weeks.','active','2026-10-09T07:30:00+08:00',NULL,'Stand by the east entrance.');
   INSERT INTO plan_meta (key, value) VALUES ('last_check', '2026-10-10T06:00:00+08:00');
   ```
   The sports pitch suggestion (P4) appears on the next `POST /plan/recheck`, but only if the events table has 3 confirmed incidents there at 17:00 in the last 28 days.
5. **Vercel env:** set `NEXT_PUBLIC_API_URL=https://earl-eye-backend.onrender.com` and `NEXT_PUBLIC_API_RESOURCES=events,plan,site`, then redeploy the web app. The guard app on a phone then reads and writes the same database as the desk. Plan writes then go to the API. If a write fails with 404/405/503 or a network error, it falls back to "Saved on this computer".
6. **Optional cron.** The check also runs lazily on the first `GET /plan` after 06:00, so a cron isn't required. If you want one: a Render cron job, `curl -X POST $API/plan/recheck` at `0 22 * * *` UTC (06:00 MYT).

## Acceptance (curl against Render)

```sh
API=https://earl-eye-backend.onrender.com
curl -s $API/site | jq '.staff[] | {name, display_name, shift: .shift.label}'      # 4+ people with names and shifts
curl -s $API/plan | jq '.last_check, (.slots[] | {id, status, assigned_to})'        # P1–P3 active
curl -s -X PATCH $API/plan/slots/P3 -H 'content-type: application/json' -d '{"assigned_to":"Guard A"}' | jq '{assigned_to, seen_at}'   # Guard A, null
curl -s -X POST $API/plan/slots/P1/checkins -H 'content-type: application/json' -d '{"staff":"Guard B"}' | jq '.checkins | length'
curl -s -X PATCH $API/events/<id> -H 'content-type: application/json' -d '{"arrived_at":"2026-10-10T22:05:00+08:00","outcome":"sorted"}' | jq '{arrived_at, outcome}'
curl -s -X PATCH $API/staff/Guard%20B -H 'content-type: application/json' -d '{"on_duty":true}'          # {"name":"Guard B","on_duty":true}
curl -s -X POST $API/events/<id>/backup -H 'content-type: application/json' -d '{"reason":"need_backup"}' | jq '{incident_id, pushed_to}'   # <id>-B, next guard
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH $API/plan/slots/P9 -H 'content-type: application/json' -d '{"status":"ended"}'   # 404
```

Then open the deployed `/plan` on a laptop and `/guard` on a phone. Assign a guard on the laptop, and the phone shows the post within 2 s. Tap "I'm at my post" on the phone, and the laptop shows the check-in.

## Not in #28 (say so if asked)
- **No auth.** It's on the CUT list. Anyone with the URL can change posts.
- **Edge must keep posting:** auto-escalation runs on the edge's repeat posts (every 0.5 s while ≥ tense). If the scene calms and the edge stops posting, the desk card still shows "No answer in 20 s" and the desk sends the next guard by hand.
- **No push notification to the phone.** The guard app polls every 2 s. Web Push is the production answer, for Q&A only.
- **Hotspot times:** `GET /hotspots` and `GET /plan` now bucket by Malaysia time. Before #28 they used UTC, so they were 8 hours off.
