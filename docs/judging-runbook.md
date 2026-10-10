# EarlyEye — Judging Runbook (Sat 18:45 → Sun 08:30)

Scored against the **Dormathon 2026 rubric**: 5 criteria × 20. Band 75–89 = Phase 2 shortlist, 90–100 = track prize.

| # | Criterion | Now | After this runbook |
|---|---|---|---|
| 1 | Problem Clarity & Value Proposition | 17 | 18 |
| 2 | Predictive Rigor & Data Robustness | **15** | **18** |
| 3 | Decision Support & Actionability | 19 | 19 |
| 4 | Explainability & Trust | 18 | 19 |
| 5 | Live Execution, Prototype & Pitch | **14** | **19** |
| | **Total** | **~83** | **~93** |

Everything below is either already done (PR #19) or has an owner, a command and a clock.

---

## DONE — PR #19 `judging: cold-open demo, disclosure, IR frame, README`

| Fix | Criterion | What changed |
|---|---|---|
| **Cold-open demo** | 5 | `replay` now starts by itself once the edge probe says we are not on site. A judge opening the deployed link with no camera sees the full escalation instead of a quiet screen. `?replay=1` forces, `?replay=0` suppresses, on site the webcam still drives it. (`web/src/components/live/live-screen.tsx`) |
| **Disclosure rendered** | 4 | `proof.disclosure` was written, typed, and invisible. Now its own verbatim block on `/proof`. |
| **IR frame shown** | 4, 2 | `public/ir-frame.jpg` was unreferenced. `/proof` now shows the night frame with an explicit "we have not run pose on infrared, so we do not claim night", and swaps to real numbers the moment `ir_check` is filled. |
| **README** | 1, 5 | Was one line. Now: demo link, API link, rubric mapping, real measured numbers, honest not-measured list, run instructions, privacy, business. |
| **render.yaml** | 5 | `<YOUR_GITHUB>` placeholder fixed. |

`npm run build` passes, 11/11 static pages.

---

## P0 — before anyone sleeps

### 0.1 Paste the Vercel URL · Kayla · 2 min
`README.md` has **`TODO_VERCEL_URL`** in three places. Replace all three. This is a graded submission artifact and the link is non-negotiable.

```bash
cd ~/Projects/earlyeye
sed -i '' 's|TODO_VERCEL_URL|https://<your>.vercel.app|g' README.md
git add README.md && git commit -m "README: deployed link" && git push
```

### 0.2 Merge the open PRs · whoever owns each · 20 min
- **#19** (this runbook's fixes) — merge first.
- **#18** `api: live loop per contract §6 … proof from model` — the deployed `/proof` currently serves a **seeded DB row with invented numbers** (hug FP 0.04 vs the real 0.192, lead time 5.8 s vs unmeasured). Nothing reads it today because the dashboard uses mock, but one env flag would expose it. Merge it.
- **#16** 3D campus — merge or close; do not leave it open at submission.

### 0.3 Test the deployed link cold · Kayla · 10 min
On **mobile data, not venue wifi**, in a private window:
1. Open the URL. The escalation must start by itself: calm → tense → amber with "fight likely in ~6 s" → red + alarm.
2. Open `/push?staff=Guard%20B` on a phone, tap **I'm on duty**, then `?demo=1` and confirm the red takeover + countdown.
3. Open `/proof`. Every unmeasured tile must read **NOT MEASURED**, never a number.
4. Open `/plan`. Confirm the top slot matches what the pitch says (see 2.1).

---

## P1 — the 3 points that are sitting on the floor (criterion 2)

**This is the single highest-value hour left in the hackathon.** The 16–20 band for Predictive Rigor says *"demonstrates low false alarms; resilient against noise, outliers, missing values."* Right now `fa_per_camera_hour`, `live_precision/recall` and `lead_time_s` are all null, so criterion 2 is capped at ~15 no matter how good the model is.

### 1.1 Venue footage session · Model A + Model B + 2 actors · 90 min

**Setup:** phone or laptop camera mounted **high** (tape, tripod, a stack of books on a chair) pointing at a taped zone, venue lighting, whole bodies visible including feet.

**Part A — 30 minutes of normal (the false-alarm denominator):**
```bash
cd model
python live_detector.py --camera 0 --log own_normal.csv
```
Let it run while people genuinely behave: walking past, standing and chatting, hugs, high-fives, handshakes, someone waving, two people laughing and pushing a chair. **Do not act a fight.** Leave the room, let it run on an empty corridor for 10 of the 30 minutes.

**Part B — 5 escalation clips (the lead-time numerator):**
```bash
python live_detector.py --camera 0 --log own_escalations.csv
```
Each clip: talk calmly ~10 s → step closer → raise arms → one slow fake shove. **Say the wall-clock second of the shove out loud and write it down** — lead time is `shove_time − first_amber_time`. Five takes. Agree every move first, keep it slow, no contact.

**Part C — turn it into numbers:**
```bash
python tune_live.py --log own_normal.csv
python tune_live.py --log own_normal.csv --apply   # only if it beats the current thresholds
```
Then fill `model/proof.json`:
- `fa_per_camera_hour` = alarms in Part A ÷ 0.5 h
- `own_footage_minutes` = 30
- `live_precision` / `live_recall` from Parts A + B
- `lead_time_s` = the five `shove − amber` values
- delete `"note"` once nothing is a placeholder

**Then copy it to the dashboard** — this is the step people forget:
```bash
cp model/proof.json web/public/mock/proof.json
```

**What this unlocks on screen:** the lead-time strip renders, the false-alarms tile moves from the hatched "Not measured yet" column into "Proven", and the dataset-vs-live table's venue row fills in. That is the difference between 15 and 18.

### 1.2 IR check · Model A · 15 min
Grab 3 real night/IR CCTV stills (any public night-CCTV frame), run them through the pose model, screenshot the result, and fill:
```json
"ir_check": { "frames": 3, "skeletons_detected": 1, "note": "pose finds a skeleton in bright IR, loses it past ~6 m", "image": "/ir-frame.jpg" }
```
Replace `web/public/ir-frame.jpg` with your own frame if it is clearer. `/proof` already has the panel waiting; filling this swaps it from "we do not claim night" to a measured statement, and it kills the hardest Q&A question.

---

## P2 — pitch and polish

### 2.1 Align the pitch with live data · Pitch · 10 min
`/plan` currently ranks **Car Park A** (1.05 avoided/week) above **Block C stairwell** (0.75). If the script says "Block C", either say Car Park A on stage or reseed so the stairwell leads. **Never say a number the screen contradicts.**

### 2.2 Frame the 19% before a judge finds it · Pitch · rehearsal only
> "One in five hugs crosses the raw model threshold. That is exactly why 'tense' is silent and never pings anyone, and why only a sustained fight-likely wakes a human — capped at three pushes a shift. The false-alarm problem is solved in the alerting design, not by pretending the model is perfect."

This turns the worst number on the page into evidence of design judgement. Say it unprompted.

### 2.3 Record the backup video · Kayla · 30 min, by 03:00
In the venue, in venue lighting: negatives (hug, high-five, chat) → escalation → alert card → **phone going red in frame** → plan → proof. Put `demo.mp4` in the repo and on a slide, playable in 2 seconds. Phase 2 is a video call — screen-share the recorded escalation plus the live dashboard, never act live over a call.

### 2.4 Small UI nits · Kayla · 20 min if time
- `public/proof-clips/` does not exist, so the clip inspector shows "KEYPOINTS NOT EXPORTED YET" for all 5 clips. Either export them or hide the inspector.
- On the Live card, **Confirm: real** only appears after a push, so a judge who clicks Dismiss first never sees it. Consider relabelling the pre-push button "Dismiss: false alarm" so the labelling story is visible either way.
- `web/src/components/shell-preview.tsx` is dead code.

---

## Submission checklist (08:00 Sunday)

- [ ] Public GitHub, README with the live link
- [ ] Deployed dashboard opens on **mobile data** and demos itself with no camera
- [ ] Slides exported to **PDF**
- [ ] Team name + Taylor's branch on the form
- [ ] `demo.mp4` in the repo and on a slide
- [ ] No secrets: `grep -rn "sk-ant\|SUPABASE_SERVICE" --exclude-dir=node_modules .`
- [ ] `/proof` shows no number the model did not produce
- [ ] **Submitted by 08:30** (hard buffer 09:00, deadline 09:30)

## The three sentences that win the Q&A

1. *"Dataset numbers are on the left, honest gaps are on the right, and the page says which is which."*
2. *"One in five hugs crosses the raw threshold — that's why tense is silent and only a sustained fight-likely wakes a human."*
3. *"We don't claim night, verbal bullying, or weapons. Here's the IR frame, and here's why our first customer is a daylight campus control room."*
