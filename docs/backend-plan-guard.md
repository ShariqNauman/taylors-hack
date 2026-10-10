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
5. **Vercel env:** set `NEXT_PUBLIC_API_RESOURCES=events,plan,site` and redeploy the web app. Plan writes then go to the API. If a write fails with 404/405/503 or a network error, it falls back to "Saved on this computer".
6. **Optional cron.** The check also runs lazily on the first `GET /plan` after 06:00, so a cron isn't required. If you want one: a Render cron job, `curl -X POST $API/plan/recheck` at `0 22 * * *` UTC (06:00 MYT).

## Acceptance (curl against Render)

```sh
API=https://earl-eye-backend.onrender.com
curl -s $API/site | jq '.staff[] | {name, display_name, shift: .shift.label}'      # 4+ people with names and shifts
curl -s $API/plan | jq '.last_check, (.slots[] | {id, status, assigned_to})'        # P1–P3 active
curl -s -X PATCH $API/plan/slots/P3 -H 'content-type: application/json' -d '{"assigned_to":"Guard A"}' | jq '{assigned_to, seen_at}'   # Guard A, null
curl -s -X POST $API/plan/slots/P1/checkins -H 'content-type: application/json' -d '{"staff":"Guard B"}' | jq '.checkins | length'
curl -s -X PATCH $API/events/<id> -H 'content-type: application/json' -d '{"arrived_at":"2026-10-10T22:05:00+08:00","outcome":"sorted"}' | jq '{arrived_at, outcome}'
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH $API/plan/slots/P9 -H 'content-type: application/json' -d '{"status":"ended"}'   # 404
```

Then open the deployed `/plan` on a laptop and `/guard` on a phone. Assign a guard on the laptop, and the phone shows the post within 2 s. Tap "I'm at my post" on the phone, and the laptop shows the check-in.

## Not in #28 (say so if asked)
- **No auth.** It's on the CUT list. Anyone with the URL can change posts.
- **No push notification to the phone.** The guard app polls every 2 s. Web Push is the production answer, for Q&A only.
- **Hotspot times:** `GET /hotspots` and `GET /plan` now bucket by Malaysia time. Before #28 they used UTC, so they were 8 hours off.
