# EarlyEye Frontend Build Brief: v3 Light Console

**For:** the agent building `web/` · **Owner:** Kayla (Web B) · **Date:** Sat 10 Oct 2026 · **Status:** design approved, build now
**Submit:** Sun 11 Oct 08:30. The deployed Vercel link is non-negotiable and must be useful with no camera attached.

---

## 0. Read first

1. `CLAUDE.md`: hard rules, scope, claim discipline.
2. This brief: what to build and how it should look and behave.
3. `docs/kayla-frontend-plan.md`: the TypeScript contract (binding), stack, timeline.
4. `docs/work-split.md`: frontend tasks F1–F10 and the integration tests in §4.
5. `design/canvas/L3*.dc.html`: the visual source of truth (see `design/README.md` for how to read them).
6. `model/REPORT.md`: the real model numbers the Proof page shows.
7. `docs/campus-3d-agent-prompt.md`, `design/canvas/Campus3D.dc.html` and `design/assets/`: the 3D model of the real Taylor's Lakeside campus, used on Cameras, Plan and the Live card.

**You own `web/` only.** Never edit `edge/`, `api/`, `model/`, `data/`. If a contract field must change, edit `docs/kayla-frontend-plan.md` and `docs/earlyeye-TEAM-FINAL.md` §6 in the same commit.

**Git:** one branch per screen, PR each, squash-merge, rebase on `main` before a PR. Never add `Co-Authored-By` trailers or "Generated with" footers.

---

## 1. What we are building

A light, video-first security console. It feels like Ambient.ai or ZeroEyes, but on a light background: condensed uppercase headings, mono camera codes, corner brackets on camera frames, a camera wall, and a **3D model of the real Taylor's Lakeside campus** you can look around and click into. Volt's plain-words alert cards and trust chips sit on top. Camera frames stay dark because camera feeds are dark.

| Route | Screen | Who | Job |
|---|---|---|---|
| `/` | **Live** | Desk operator | See the build-up, get the alarm, send one person, label it |
| `/cameras` | **Cameras** | Operator, manager | 3D campus: click a building or pin to open its feed. Then all cameras, health and activity. |
| `/incidents` | **Incidents** | Operator, manager | Case review: evidence, why this type, audit trail, label, note |
| `/plan` | **Plan** | Manager | 3D campus with patrol posts and hotspot columns, then three patrol slots, assumption, heatmap, hotspots |
| `/proof` | **Proof** | Judges, buyer | Proven numbers, honest gaps, watch the model |
| `/push?staff=Guard%20B` | **Push** | Person on duty | Phone: on duty, red takeover, "On my way" |

Live is the product, Plan is the decision, Proof is the evidence.

---

## 2. Starting point in the repo

Branch **`web/scaffold`** (PR #1, draft) already has:
- Next.js 15.5, React 19, Tailwind 4, shadcn (Base UI), `swr`, `recharts`, `lucide-react`, `sonner`.
- `src/lib/types.ts` (contract v1), `src/lib/api.ts` (API with mock fallback: **keep this pattern**), `src/lib/format.ts`, `src/app/api/mock/[name]/route.ts` and `api/mock/events/[id]/route.ts`.
- `src/components/live/*`: v1 Live screen (alert card, queue, camera tiles, two-tier alarm, replay). Restyle to v3.
- Stub pages for plan, incidents, proof, push.

Do this first:
```bash
git fetch origin
git checkout web/scaffold
git rebase origin/main
```
Then update `types.ts` to the current contract in `docs/kayla-frontend-plan.md`, including `acked_at`, `site.staff`, `avoided_per_patrol_hour` and the v3 optional fields. Replace the v1 colours in `format.ts` and `globals.css` with §3. Replace the fixed 0.5 s replay ticker with **timestamp-based replay** (frontend plan, "Replay rule").

---

## 3. Design system: Light Console

### 3.1 Colour tokens

| Token | Hex | Use |
|---|---|---|
| ground | `#F1F2F4` | Page background |
| panel | `#FFFFFF` | Cards, tiles |
| raised | `#F7F8FA` | Rows, inputs, stat boxes |
| line | `#DCDFE4` | Borders |
| line-strong | `#B4BAC3` | Chips, secondary buttons, inputs |
| ink | `#0B0D10` | Text, Confirm button, corner brackets, selected nav |
| ink-2 | `#3A414B` | Secondary text |
| muted | `#5D6672` | Codes, labels (5.9 : 1 on white) |
| signal | `#2742D9` | Primary action, links, focus ring (7.3 : 1) |
| signal-tint | `#E7EBFD` | Pushed chip, remote-live badge, avoided stat |
| signal-ink | `#1F35B3` | Text on signal-tint |
| frame | `#161B22` | Camera frame, on site |
| frame-remote | `#0E1217` | Skeleton-only frame |
| frame-line | `#2A323C` | Scene lines in frame |
| grid-line | `#1A2028` | Grid in remote frame |
| person-a / b / c | `#7FE0FF` / `#C9A7FF` / `#C9CED6` | Skeleton colours, in person order |

**Colour means severity, and only severity.** Green, amber and red appear only on levels. Every level also has a shape and a word.

| Level | Glyph (24 px viewBox, filled) | Pill bg / text / border | Card tint | Box on dark frame / label text |
|---|---|---|---|---|
| calm | circle `M12 4a8 8 0 1 1-0.01 0z` | `#E4F3EA` / `#17663D` / `#9FD3B4` | `#FFFFFF` | `#3FB27A` / `#06140C` |
| tense | triangle `M12 3 22 20H2z` | `#F5B323` / `#1A1200` / `#E5A41C` | `#FFF8E6` | `#F5B323` / `#1A1200` |
| fight_likely | diamond `M12 2 22 12 12 22 2 12z` | `#C8241B` / `#FFFFFF` / `#C8241B` | `#FDEDEB` | `#FF5A4F` / `#1A0503` |
| fight | octagon `M8 2h8l6 6v8l-6 6H8l-6-6V8z` | `#7F1310` / `#FFFFFF` / `#7F1310` | `#FBE3E0` | `#FF8A80` / `#1A0503` |

| Status | Background / text / border |
|---|---|
| new | `#FFFFFF` / `#0B0D10` / `#0B0D10` |
| pushed | `#E7EBFD` / `#1F35B3` / `#A9B6F2` |
| confirmed | `#0B0D10` / `#FFFFFF` / `#0B0D10` |
| dismissed | `#F1F2F4` / `#3A414B` / `#DCDFE4` |
| resolved | `#FFFFFF` / `#3A414B` / `#B4BAC3` |

Type chips are outlined ink with a lucide icon, never coloured: Fight `Zap`, Cornering `Users`, Crowd gathering `UsersRound` or a ring of dots, Play / sports `Volleyball` or `CircleDot`.

Heatmap ramp, counts 0 to 5+: `#FFFFFF #DDE3FB #AFBDF3 #6E86E8 #3653DC #1F35B3`. Use ink text up to 3 and white text from 4. Blue means a count, never a risk level.

### 3.2 `globals.css`

Paste and adapt into `web/src/app/globals.css`. Keep shadcn's variable names so its components pick up the theme.

```css
:root {
  --background: #F1F2F4; --foreground: #0B0D10;
  --card: #FFFFFF; --card-foreground: #0B0D10; --popover: #FFFFFF; --popover-foreground: #0B0D10;
  --primary: #0B0D10; --primary-foreground: #FFFFFF;
  --secondary: #FFFFFF; --secondary-foreground: #0B0D10;
  --muted: #F7F8FA; --muted-foreground: #5D6672;
  --accent: #E7EBFD; --accent-foreground: #1F35B3;
  --destructive: #C8241B;
  --border: #DCDFE4; --input: #B4BAC3; --ring: #2742D9;
  --radius: 0.125rem;

  --ink-2: #3A414B; --line-strong: #B4BAC3; --raised: #F7F8FA;
  --signal: #2742D9; --signal-tint: #E7EBFD; --signal-ink: #1F35B3;
  --frame: #161B22; --frame-remote: #0E1217; --frame-line: #2A323C; --grid-line: #1A2028;
  --person-a: #7FE0FF; --person-b: #C9A7FF; --person-c: #C9CED6;
  --calm: #E4F3EA; --calm-fg: #17663D; --calm-line: #9FD3B4; --calm-box: #3FB27A;
  --tense: #F5B323; --tense-fg: #1A1200; --tense-line: #E5A41C; --tense-tint: #FFF8E6;
  --likely: #C8241B; --likely-fg: #FFFFFF; --likely-tint: #FDEDEB; --likely-box: #FF5A4F;
  --fight: #7F1310; --fight-fg: #FFFFFF; --fight-tint: #FBE3E0; --fight-box: #FF8A80;
}
@theme inline {
  --color-signal: var(--signal); --color-signal-tint: var(--signal-tint); --color-signal-ink: var(--signal-ink);
  --color-ink-2: var(--ink-2); --color-raised: var(--raised); --color-line-strong: var(--line-strong);
  --color-calm: var(--calm); --color-tense: var(--tense); --color-likely: var(--likely); --color-fight: var(--fight);
  --font-display: var(--font-saira); --font-sans: var(--font-atkinson); --font-mono: var(--font-atkinson-mono);
}

/* Alarm pulse: 1 Hz, only while the alarm sounds. Under 3 flashes per second (WCAG 2.3.1). */
@keyframes ee-pulse { 0%,100% { box-shadow: 0 0 0 0 rgb(200 36 27 / 0) } 50% { box-shadow: 0 0 0 8px rgb(200 36 27 / .45) } }
@keyframes ee-edge { 0%,100% { opacity: .2 } 50% { opacity: 1 } }
@keyframes ee-banner { 0%,100% { filter: brightness(1) } 50% { filter: brightness(1.35) } }
.ee-pulse { animation: ee-pulse 1s ease-in-out infinite }
.ee-edge { animation: ee-edge 1s ease-in-out infinite }
.ee-banner { animation: ee-banner 1s ease-in-out infinite }
@media (prefers-reduced-motion: reduce) { .ee-pulse, .ee-edge, .ee-banner { animation: none } .ee-edge { opacity: 1 } }
```

### 3.3 Type

| Role | Font | Size / weight | Where |
|---|---|---|---|
| Display | **Saira Condensed**, uppercase | 44 to 60 px / 800, line-height 0.95 | Level word on Live (48), ETA (44), page titles (52 to 60) |
| Section | Saira Condensed, uppercase | 24 to 30 px / 800 | "Active now", "Camera wall", "Campus in 3D" |
| Location | Atkinson Hyperlegible Next | 30 px / 800 | Alert card place name |
| Reason | Atkinson Hyperlegible Next | 22 px / 500, 20 px minimum anywhere | One-sentence reason |
| Body | Atkinson Hyperlegible Next | 15 to 16 px / 400 | Running text |
| Label | Atkinson Hyperlegible Mono, uppercase | 11 to 12 px / 700, tracking 0.06 to 0.08 em | "DO THIS", "PERSON ON DUTY" |
| Codes | Atkinson Hyperlegible Mono | 13 to 16 px / 700 | Camera IDs, times, scores, counts |

Load with `next/font/google`: `Saira_Condensed` (600, 700, 800), `Atkinson_Hyperlegible_Next` (400, 500, 700, 800), `Atkinson_Hyperlegible_Mono` (400, 700). Expose them as `--font-saira`, `--font-atkinson` and `--font-atkinson-mono`. If the installed Next version doesn't know the Atkinson families, add the Google Fonts `css2` link in `layout.tsx` instead. Do not fall back to Inter or Roboto.

### 3.4 Shape, edges, details

- Radius 2 px on cards, buttons and chips. Phone buttons use 2 to 4 px.
- Borders, not shadows: 1 px `line` by default. 2 px ink marks the one thing to look at: the current card, a selected row or pin, a decision card. The current alert card uses a 2 px border in its level colour.
- Dashed borders mean a decision, a placeholder, synthetic data or an assumption. Hatched backgrounds mean "not measured".
- **Corner brackets** on every camera frame: four 16 to 18 px L-shapes, 2 px ink, offset 5 px outside the frame.
- Mono uppercase overlays inside frames: camera ID and place top-left, LIVE / SKELETONS / REPLAY plus clock top-right, provenance line bottom-left.
- Touch targets are 44 px minimum. Confirm and Dismiss are 60 px on Live, 52 px on Incidents, and 76 to 84 px on the phone.
- Focus ring: 2 px `signal`, 2 px offset, on every control.

### 3.5 Accessibility

- All token pairs above meet 4.5 : 1 for text. The 3 : 1 cases are only at 24 px and above.
- Never rely on colour alone. Level = glyph + word + colour. Status = word. Type = icon + word.
- Icon-only buttons get an `aria-label`. Pins and tiles are real `<button>` or `<a>` elements.
- `prefers-reduced-motion`: no pulse. The red stays static.
- A 390 px phone gets no horizontal page scroll. Wide tables and the heatmap scroll inside their own box.

---

## 4. Global shell

**Header** on every desktop route, white, bottom border:
- Logo (eye mark plus `EARLYEYE` in Saira) links to `/`. Site name in mono: `TAYLOR'S LAKESIDE · 6 CAMERAS`.
- Nav: **Live · Cameras · Plan · Incidents · Proof**. Active item is ink fill with white text.
- Right side, Live only: **Arm alarm sound** (amber outline until clicked, needed for the autoplay rule) · **`N/3 pushes this shift`** (links to `/incidents?status=pushed`) · clock `HH:MM:SS MYT` · **End shift** (opens the handover drawer).
- Data-source chip: dashed `MOCK DATA` when `usingMock` or the API failed; `REPLAY` when `?replay=1`.
- View indicator: `ON-SITE DESK` or `REMOTE LINK` (§8). In dev, `?view=onsite|remote` forces it, and the prototype's toggle can stay behind that flag.

**Alarm layer**, mounted once in `layout.tsx` and driven by a small store (Zustand or React context):
- **Banner** under the header, full width: level colour, octagon glyph, `FIGHT LIKELY · AUDITORIUM` in Saira, "Guard B pushed at 14:31:06", a **View on the 3D campus** link to `/cameras?cam=…`, and **Silence**. Class `ee-banner` while sounding.
- **Screen edge**: a fixed, pointer-events-none overlay with `box-shadow: inset 0 0 0 8px #C8241B, inset 0 0 90px rgb(200 36 27 / .55)` and class `ee-edge`, while sounding.
- **Sound**: one `<audio src="/alarm.mp3" loop>`. It plays only after the operator arms it.
- **Toast** (sonner): "Pushed to Guard B · 14:31:06", subline "One person only. They see a skeleton snapshot, not video.", and a link "Open their phone screen" to `/push?staff=…`.

---

## 5. Click map: every clickable element and where it goes

| Element | Screen | Goes to or does |
|---|---|---|
| Logo | All | `/` |
| Nav items | All | Their routes |
| Pushes counter | Live header | `/incidents?status=pushed` |
| Arm alarm sound | Live header | Plays and pauses the audio once to unlock it. Label becomes "Sound armed". |
| End shift | Live header | Opens the handover drawer |
| Restart demo feed | Live, the "no camera connected" strip | Restarts `?replay=1` from event 1 |
| LIVE / REPLAY tabs | Live evidence panel | Switch between the live stream and scrubbing the last 12 s |
| Timeline cells, step back/forward, Play | Live replay bar | Seek or play the incident buffer |
| Queue row | Live | Selects that incident for the card and evidence panel |
| Push [name] now (tense only) | Live card | `PATCH {status: "pushed"}` (operator early push), then toast |
| Confirm: real / Dismiss: false alarm | Live card, Incidents | `PATCH {status}`. Stops the alarm. The card shows the decision and Undo. |
| Undo | Live card | `PATCH` back to the previous status |
| "Open the 3D campus", under the compact 3D view | Live card | `/cameras?cam=<id>`. The compact view itself is locked and not clickable. |
| Open the case | Live card | `/incidents?id=<incident_id>` |
| Camera and 3D campus | Live card | `/cameras?cam=<id>` |
| [name]'s phone screen | Live card | `/push?staff=<name>` |
| View on the 3D campus | Alarm banner | `/cameras?cam=<id>` |
| Silence | Alarm banner | Stops sound and pulse. The banner stays until labelled or the level drops. |
| "Camera wall" heading, "All cameras and the 3D campus" link, any tile | Live | `/cameras?cam=<id>` |
| Handover links | Handover drawer | "Label open alerts" goes to `/incidents?status=open`, "Report the black camera" to `/cameras?cam=CAM-HC-02` |
| Copy summary | Handover drawer | Copies a plain-text shift summary to the clipboard. Label becomes "Summary copied". |
| 3D building, or its label | Cameras, Plan | Cameras layer: opens that building's camera in the info card. Plan layer: opens its patrol post. |
| 3D camera pin (LIVE, REC or black) | Cameras | Info card: feed, level, people, **Open live view** (or **Play recording in Live**) and **Camera details**. Also selects it in the detail panel below. |
| 3D patrol post pin | Plan | Info card: incidents in 4 weeks, avoided a week, hours a week, rationale, **Open in Plan**, **See the incidents** |
| 3D controls: drag, rotate, Top, Tilt, + and −, Reset view, Jump to | Cameras, Plan | Move the view. Jump to flies to Auditorium, Block C, Syopz Mall, Sports centre, DK Senza or Whole campus. |
| CAMERAS / PATROL PLAN toggle | 3D view | Switch layer |
| Filter chips All / Live webcam / Recordings / Black / With an incident | Cameras | Filter the grid |
| Grid tile | Cameras | Selects that camera |
| Report repair (black camera only) | Cameras detail | Local state "Repair reported · HH:MM". No backend in v3. |
| Open in Live / See its incidents / Patrol plan | Cameras detail | `/?cam=`, `/incidents?cam=`, `/plan` |
| Status filter chips, list rows | Incidents | Filter the list, open a case |
| Play 10 s clip on site | Incidents case, on site only | Plays `${camera.edge_url}/clips/<incident_id>.mp4` in a `<video>` inside the frame. Hidden on the remote link. |
| Open this camera on the 3D campus | Incidents case | `/cameras?cam=` |
| Mark resolved, staff note | Incidents case | `PATCH {status: "resolved", staff_note}` |
| Show on the heatmap | Plan slot | Selects the zone and outlines that slot's cells |
| See the incidents behind this slot | Plan slot | `/incidents?cam=<camera>` |
| Open the camera | Plan, black-camera strip | `/cameras?cam=CAM-HC-02` |
| Zone chips | Plan heatmap | Filter the heatmap |
| Review the incidents behind these | Plan hotspots | `/incidents` |
| Clip cards, Play | Proof inspector | Select and animate an example |
| Show / Hide | Proof model card | Toggle |
| I'm on duty | Push | Unlocks audio, wake lock, fullscreen, then the on-duty screen |
| On my way | Push, pushed state | `PATCH {acked_at: now}`, then "Acknowledged in N s", then back to on duty after 5 s |
| Send a test push | Push, demo only, behind `?demo=1` | Starts a local 10 s pushed state |

---

## 6. Screens

The canvas files are exact references for layout, sizes and copy. This section lists behaviour and data.

### 6.1 Live (`/`), design file `L3Live.dc.html`

**Layout:** the "no camera connected" strip, shown only when no live event has arrived in the last 60 s and replay is running. Below it, two columns at 3 : 2 that wrap under about 1040 px:
- **Left, the evidence panel:** LIVE / REPLAY tabs, `CAM-ID · INCIDENT-ID`, a mode badge, the camera frame with corner brackets, the replay bar (REPLAY only), a 12-cell level timeline with the playhead, the marks `AMBER :03 · PUSHED :06 · SHOVE :09`, "Warned N s before the shove on this replay", and **four feature meters** from `top_features`. The meters are hidden if the field is absent.
- **Right, the alert card**, then the **Active now** queue.

**Alert card, top to bottom:**
1. Level pill: glyph plus Saira 48 px word.
2. Type chip.
3. ETA in Saira 44 px. "Fight likely in ~N s" when `eta_seconds` is set, "Fight in progress" at fight, "No build-up" at calm, otherwise "Watching · no ETA".
4. Location at 30 px, then a mono meta line: `CAM · ZONE · RISK · N PEOPLE`.
5. Reason at 22 px.
6. Two boxes: **DO THIS** with the action, and **PERSON ON DUTY** with the name, distance and push state.
7. Compact 3D campus (§9), focused on the incident's building, with the nearest guard and route, and "Open the 3D campus" under it.
8. Four-step progress strip: 01 DETECT, 02 EXPLAIN, 03 PUSH, 04 CONFIRM, each with a time.
9. Buttons: tense and not pushed shows **Push [name] now** and **Dismiss**. Pushed shows **Confirm: real** and **Dismiss: false alarm**. Once decided, a decision row with **Undo**.
10. Links row: Open the case · Camera and 3D campus · [name]'s phone screen.

**Queue:** active incidents (level tense or above, no `end_time`, not dismissed), sorted by `priority` descending. Each row shows rank, level pill, location, type, time since, and priority. The selected row gets a 2 px level border and the level tint.

**Camera wall:** 6 tiles in an auto-fit grid, minimum 220 px. Each tile shows a frame (on site: video or skeletons; remote: skeletons during incidents, otherwise "N people in view" from `people_count`), the ID with **· LIVE** (red dot) or **· REC** (grey dot), the level chip, location, and the last frame or recording time. A black camera shows `NO SIGNAL` and "Black for N days". The alarming camera's tile gets `ee-pulse` and a 2 px red border.

**Handover drawer:** a sheet from the right. Stats: pushes used, incidents still open, alerts with no label, cameras black. A hand-over list of 3 or 4 generated lines, two links, and Copy summary.

**Data:** `GET /events?since=` every 2 s, plus a full `GET /events` every 10 s and merge (see §11). `GET /cameras` every 10 s. `GET /site` once.

**Acceptance:**
- `?replay=1` shows amber before red.
- The ETA counts down with the wall clock.
- The alarm sounds once, if armed.
- The pulse runs on the banner, screen edge, card and tile.
- The toast appears.
- Confirm stops everything and survives the next poll.

### 6.2 Cameras (`/cameras`), design file `L3Cameras.dc.html`

**Layout:** title row with filter chips **All 6 · Live webcam 1 · Recordings 4 · Black 1 · With an incident N**. Then a full-width **Campus in 3D** section (`<Campus3D mode="cameras">`, §9). Below it, the **grid** on the left and the **detail panel** on the right.

- **Campus in 3D:** the real Taylor's Lakeside campus. The full spec is in `docs/campus-3d-agent-prompt.md`, and the interaction reference is `design/canvas/Campus3D.dc.html`.
- **Grid:** larger tiles, same content as the Live wall plus zone, risk and last frame.
- **Detail panel:** ID with its source (LIVE WEBCAM, RECORDING or NO SIGNAL) and level, big location, frame, then a definition list: SOURCE ("Live webcam on the demo laptop", "Recording made Sat 10 Oct 16:20, looping", or black since and for how long), BUILDING, ZONE, IN VIEW NOW, ALERTS TODAY, LAST 4 WEEKS, HOTSPOT. Then a label bar showing confirmed against dismissed, with a hint when dismissals dominate ("Mostly false alarms: ask to retune this camera"). Actions as in §5.
- `?cam=<id>` preselects a camera.

### 6.3 Incidents (`/incidents`), design file `L3Incidents.dc.html`

**KPIs:** labels collected (ink tile), confirmed, dismissed, and median response, which is the median of `acked_at − pushed_at`. Show "—" when no `acked_at` exists.

**List** (left, about 420 px): status chips All · Open · Confirmed · Dismissed · Resolved. Each row has a 104 px skeleton thumbnail from `peak_snapshot` (a dark tile if absent), level pill, type, status chip, location, and a mono line `DAY HH:MM · CAM · P 0.40 · ACK 4 S`.

**Case** (right):
- Header: level pill, type, status, ID, location, and `when · cam · zone · priority`, plus the camera and Live links.
- Evidence frame: peak frame with box and label. On site, add **Play 10 s clip on site**. Remote shows "Video stays on site…".
- **Why this type:** a four-rule checklist with met or not met (tick or cross, green or grey). The rules are the type rules from team plan §5: two parties with strike pattern; 1 against 3 or more for over 5 s; 5 or more close with low motion; sports zone or rhythmic motion. Under it: "Types are rules on top of the model's score, not a separate model."
- **Why the model flagged it:** the reason at 20 px.
- **Audit trail**, built from the timestamps: start (tense, silent) · fight likely, pushed · tapped "On my way", response N s · fight · confirmed or dismissed · resolved.
- **Staff note** textarea, Confirm, Dismiss, Mark resolved, and the line "The desk's Confirm or Dismiss is the label. The phone tap only records 'on my way'."
- `?status=`, `?cam=` and `?id=` deep links.

### 6.4 Plan (`/plan`), design file `L3Plan.dc.html`

- Title "Where to put people this week" over a mono line built from `plan.generated_at`, for example `PATROL PLAN · WEEK OF MON 12 OCT · BUILT SAT 10 OCT 14:30`.
- **This week on the campus**, first: `<Campus3D mode="plan">`. Each patrol slot is a blue post pin (`P/01 · MON–THU 13:00–14:00`) with a blue column whose height is its incidents in 4 weeks. Clicking a post opens its card. The mentors asked for this view, so it goes above the cards.
- **Three slot cards:** `P/01`, "PLACE ONE PERSON AT", location in Saira, days and hours in ink chips. Three stats: incidents in 4 weeks; **avoided a week** in the signal-tint box with "≈ N a month"; avoided per patrol hour with hours per week. Then the rationale, **Show on the heatmap**, and "See the incidents behind this slot".
- **Assumption** strip, dashed: "60% of hotspot incidents are avoided when a person is present. Stated, not measured. Avoided = incidents in 4 weeks × 0.6."
- **Black camera** strip, ink: "CAM-HC-02, DK Senza corridor L5, black for 3 days. Slot P/02 is the only eye on that block.", with **Open the camera**.
- **Heatmap:** zone chips, then a 7 × 24 CSS grid with hour headers 00–23 and MON–SUN rows. Each cell shows its count and a tooltip. The selected slot's cells get a 2 px ink outline. Legend underneath.
- **Hotspots** list beside it, with the rule sentence and a link to Incidents.
- Wording: "~3 a month" for Block C. Never "~3 a week".
- SHOULD, after 23:00: a "Weekly summary" button that calls `POST /report` and shows the text in a sheet.

### 6.5 Proof (`/proof`), design file `L3Proof.dc.html`

Show **real numbers from `model/REPORT.md` v2** and say clearly what is not measured. Banner: `SOURCE: MODEL REPORT V2`, "Dataset numbers are real, from 600 public RLVS clips. Live room, CCTV angle, lead time and night are not measured yet, and this page says so."

| Proven tile | Value | Sub-line |
|---|---|---|
| CLIP ROC-AUC | 0.876 | 600 RLVS clips, 5-fold split by video. Best of 20 settings, so slightly optimistic. |
| FIGHTS CAUGHT | 82% | At about a 20% false-alarm rate on the same clips. |
| LIVE LOGIC REPLAY | 75.7% | Fight clips that reach fight after smoothing and the 1 s hold. Calm clips: 13.7%. |
| WEBCAM RESOLUTION | 0.902 | Clip AUC on 241 to 480p clips. |
| TIME TO FIGHT LEVEL | 2.1 s | Mean delay after a fight starts, in the replay. Detection, not early warning. |

**Not measured** tiles, hatched, each with what is needed: lead time before the shove (5 escalation clips in the venue), false alarms per camera-hour (30 min of own normal footage), hugs and high-fives (own clips; `model/record_clips.py` exists), the CCTV-angle row, and night or IR (one IR frame).

**Watch the model** inspector: five clips. "Fight caught · V_71" (in training, so it proves the pipeline only), "Fight missed · V_1" (arms only, peak 0.39), "Calm clip" (13.7% of calm clips reach fight), "Hug" (not tested), "CCTV angle" (not tested). Each shows ground truth against what the model said, plus a why. Use a skeleton illustration until real keypoints are exported.

**What the model leans on:** a horizontal bar chart of LightGBM gain. `pair_motion_energy` 47%, `max_wrist_speed` 13%, `wrist_peaks_per_s` 7%, `max_wrist_accel` 6%, the other six 3–5% each.

**Dataset against live room** table, plus the **LESSON** line. **Known weaknesses** (5), **We claim**, **We do not claim**, and a collapsed **Model card** with the real parameters from REPORT §6.

**Data:** read `GET /proof` and map it. Show a metric as **not measured** when its source is missing: `own_footage_minutes === 0`, an empty `lead_time_s`, no `cctv_domain`, or `ir_check.frames === 0`. The report-only figures (75.7%, 13.7%, 0.902, 2.1 s, feature gains) are not in the contract. Keep them in `web/src/lib/model-report.ts` with a `// source: model/REPORT.md v2` comment. Never invent a number. A slot with no source says "not measured".

### 6.6 Push (`/push?staff=Guard%20B`), design file `L3Push.dc.html`

A phone layout at 390 px. States:
1. **Off duty:** "START YOUR SHIFT", one line of explanation, and **I'M ON DUTY** (84 px, ink). The tap plays and pauses the alarm to unlock audio, calls `navigator.wakeLock.request("screen")`, then `requestFullscreen()`.
2. **On duty, idle:** green dot, "ON DUTY · SCREEN STAYS AWAKE", "NO ALERTS. ALL QUIET.", pushes `1/3`, cameras live `5/6`, "Your patrol slot today", and a line about two tiers.
3. **Pushed:** the whole screen turns `#C8241B`. "FIGHT LIKELY" in Saira with a diamond and time. A white card holds the location in Saira, type chip, "in ~6 s · ~40 m · 2 people", a **skeleton snapshot** from `peak_snapshot` or `snapshot` labelled "SKELETON SNAPSHOT · NO VIDEO", and the reason. Then a 10 s countdown ring and **ON MY WAY** (80 px white). Play the looped alarm and call `navigator.vibrate?.([500,200,500,200,800])`.
4. **Acknowledged:** green "ACKNOWLEDGED IN N S", then back to idle after 5 s.
5. **Timeout:** "NO ANSWER IN 10 S. The desk can see you did not answer and will call you by radio."

Poll every 2 s for an event where `pushed_to === staff && status === "pushed" && !acked_at`.

---

## 7. Alarm and two-tier state machine

| Incident level | Banner | Pulse | Sound | Push | Toast |
|---|---|---|---|---|---|
| calm | none | none | none | none | none |
| tense | none | none | none | none; operator may push early | only if the operator pushes |
| fight_likely | red | yes, until silenced or labelled | yes, if armed, looping | the API sets `pushed_to`; budget 3 per shift | "Pushed to …" |
| fight | dark red | yes | yes | always, budget ignored | if newly pushed |

- An alarm starts on the **transition** of an incident into fight_likely or fight. An incident already pushed long ago is history: no sound. The scaffold already has this staleness guard, so keep it.
- **Silence** stops sound and pulse for that incident. **Confirm** or **Dismiss** stops them and records the label. The level dropping below fight_likely stops them.
- Only one alarm sounds at a time. The highest-priority alarming incident drives the banner.
- **The live model today only emits calm, tense and fight** (§12). If fight arrives without fight_likely first, push and alarm at fight. That is still correct.

---

## 8. Real time, video, one live webcam and recordings

### 8.1 Camera setup: 1 live webcam, 4 labelled recordings, 1 black

**One camera is live:** the demo laptop's webcam, filming the auditorium where we pitch. The others play **our own recordings**: short clips we film on site with a laptop webcam, staged by the team, of the stairwell, the food court, a hostel corridor and the pitch. Each recording runs through the same edge pipeline as the webcam. `model/live_detector.py --camera <file.mp4>` already plays a file in real time, so recordings produce real events, keypoints and alerts, not canned UI.

| Camera | Place (real building) | Source | Role |
|---|---|---|---|
| `CAM-AU-01` | Auditorium, Block A and B | **live webcam**, demo laptop | Actors stage the escalation here, in front of the judges. This drives the live alarm. |
| `CAM-BC-03` | Block C stairwell | recording | The patrol plan's top hotspot |
| `CAM-CT-04` | Syopz Mall food court | recording | Crowd type |
| `CAM-HC-01` | DK Senza, corridor L3 | recording | Hostel corridor at night |
| `CAM-SC-06` | Sports pitch | recording | Play suppressed in the sports zone |
| `CAM-HC-02` | DK Senza, corridor L5 | none, **seeded black** | Camera-health story |

**Recordings are always labelled.** Show `REC` on every tile, pin and frame, and the recording time in the detail panel: "Recording made Sat 10 Oct 16:20, looping". Never present a recording as live. Recording files stay on the laptop. They are never committed to `web/` and never uploaded. The remote link shows skeletons from them, never pixels.

Each camera has its own edge process, which is Model A's code, not yours. It posts events and heartbeats to the Render API, and serves the endpoints below at its `edge_url`. With everything on laptop 1, use one port per camera, for example `http://127.0.0.1:8765` for the webcam and `:8766` to `:8769` for the recordings.

| Edge endpoint | Returns | Used by |
|---|---|---|
| `GET /health` | `{ ok: true, camera_id, source }` | On-site detection, camera tile online dot |
| `GET /stream.mjpg` | MJPEG with skeletons drawn, about 10 fps, 640 × 480, for the webcam or the looping recording | Live evidence frame, camera wall, Cameras grid and detail, 3D info card, on site only |
| `GET /clips/<incident_id>.mp4` | The 10 s clip saved around that incident | Incidents "Play 10 s clip on site", on site only |

Contract additions: `Camera.source?: "live" | "recorded"`, `Camera.recorded_at?: string`, `Camera.edge_url?: string`, `Camera.geo?`. The dashboard uses `edge_url` **only in the on-site view**.

**Network:**
- **Default: all edges run on laptop 1** at `127.0.0.1`. Browsers treat `127.0.0.1` as trustworthy, so the Vercel page opened **on laptop 1** can load those streams, and no hotspot is needed. Lower recordings to 5 fps if the CPU struggles.
- **If recordings move to other laptops** for load: put them on one phone hotspot, because venue guest Wi-Fi usually blocks traffic between devices. Run the on-site dashboard locally on laptop 1 (`npm run build && npm start` on `http://localhost:3000`), because an https page cannot load `http://192.168…` streams.
- The `/push` phone never shows video.

### 8.2 Two views of the same dashboard

- **On-site desk:** laptop 1. Detect it by fetching `${camera.edge_url}/health` for the live camera with an 800 ms timeout. Allow a `?view=onsite` override. If it answers, show video.
- **Remote link:** Vercel, or any case where the edges aren't reachable. **No video element is ever rendered, and no `edge_url` is ever requested.**

### 8.3 Live frame

- On site: `<img src={`${camera.edge_url}/stream.mjpg`}>` inside the frame. The edge already draws the skeletons, so overlay only the HUD text, the level box label and the corner brackets. If the stream errors, fall back to `<SkeletonView>` from `event.snapshot`.
- Remote: render `event.snapshot` with **`<SkeletonView>`**. Each poll refreshes it, so the badge reads "LIVE SKELETONS · UPDATED N S AGO". For cameras with no incident, show `people_count` from the heartbeat.
- The mode badge reads `LIVE VIDEO + OVERLAY · 0.3 S BEHIND` on site and `LIVE SKELETONS · UPDATED N S AGO` remote. The frame's bottom line reads `NO PIXELS LEAVE THE SITE · 12 BODY KEYPOINTS PER PERSON` remote.

**REPLAY tab:** keep a client-side ring buffer of the last 24 snapshots (12 s) for the selected incident, and scrub through it. In `?replay=1` mode, the replay events carry the snapshots.

**`<SkeletonView frame level label showBox showDistance trail />`:**
- `viewBox="0 0 640 360"`. Each keypoint maps to `(x × 640, y × 360)`. Skip any keypoint with conf below 0.3.
- Bones are pairs of indices into the 12 keypoints: `[0,2],[2,4],[1,3],[3,5],[0,1],[0,6],[1,7],[6,7],[6,8],[8,10],[7,9],[9,11]`.
- There are no face points. Draw the head as a circle of radius 0.2 × torso length, placed 0.34 × torso length above the shoulder midpoint, along the torso direction.
- Stroke 4 px, round caps, colour by person order: a, b, then c for the rest. Joints are white dots of radius 2.8.
- Box: around all people, padded 0.85 × torso length. 2.5 px stroke in the level's box colour. A label block above it reads `FIGHT LIKELY 0.71`.
- Optional: a dashed white line between the active pair's hips, labelled `0.45 TL`, and a dashed cyan trail for the fastest wrist over the last 0.8 s.
- Background: on site `frame` with scene lines; remote `frame-remote` with a 40 px grid.

**Poses must come from the real pipeline.** The deployed demo (`?replay=1`, and `edge/replay.py` in Phase 2) replays a **real recorded session**. Record the escalation in the auditorium on laptop 1 with the edge app. The edge saves every event it posts, snapshots included, and that file becomes `public/mock/replay.json`. Do the same for a few negatives (hug, high-five, chat) to fill `events.json` peak snapshots.

Until that recording exists, and for dev only, you may synthesise 12-keypoint frames by porting `fig(pose)` and the pose tables `PA` and `PB` from `L3Live.dc.html` into `web/src/lib/mock-poses.ts`. The prototype draws a side view with both shoulders at the neck. When converting, put the left and right shoulder 6 px either side of the neck, and do the same for the hips. Any screen fed by synthetic poses shows a dashed `SYNTHETIC POSES` chip. **Replace them with the recording before the 03:00 run-through.**

**Proof inspector:** Model B exports the real keypoints for the example clips (V_71 caught, V_1 missed, one calm clip) from the extraction pipeline as `PoseFrame[]` JSON in `web/public/proof-clips/`. Until those files land, each card says "Keypoints not exported yet" instead of a drawing.

**`top_features`** drives the four meters on Live: name, value, and a bar. Highlight a bar when its value is at least 0.6. If the field is absent, hide the meters and keep the reason sentence.

---

## 9. 3D campus: the real Taylor's Lakeside

Every map in the product is the 3D campus, in three places:
- **Cameras:** full, cameras layer.
- **Plan:** full, patrol plan layer.
- **Live alert card:** compact and locked.

**Build it on its own branch with `docs/campus-3d-agent-prompt.md`.** That prompt has the engine choice, the API, the behaviour and the acceptance tests. In short:
- **Real view:** Google Photorealistic 3D Tiles through deck.gl when `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is set.
- **Fallback:** the OpenStreetMap footprints in `design/assets/taylors-lakeside-campus.geojson`, extruded. Use this always on the Live card, in mock mode, and when the tiles don't load within 5 s.
- **No WebGL:** a flat top-down view of the same footprints.

The real buildings, from OpenStreetMap: Block A and B, Block C, Block D, Block E, Syopz Mall, the sports centre and pitches, and the lake. DK Senza is the student residence just south of campus. Heights are estimates.

Copy `design/assets/campus-3d-seed.json` and the GeoJSON to `web/public/campus/`. Seed positions:

| Camera | Place | Source | lat | lng |
|---|---|---|---|---|
| CAM-AU-01 | Auditorium, Block A and B | live | 3.0645574 | 101.6170349 |
| CAM-BC-03 | Block C stairwell | recorded | 3.0640871 | 101.6175477 |
| CAM-CT-04 | Syopz Mall food court | recorded | 3.0638158 | 101.6164681 |
| CAM-HC-01 | DK Senza, corridor L3 | recorded | 3.0601983 | 101.6173498 |
| CAM-HC-02 | DK Senza, corridor L5 | black | 3.0599270 | 101.6170619 |
| CAM-SC-06 | Sports pitch | recorded | 3.0617539 | 101.6172328 |

| On-duty post (site.staff) | zone_type | lat | lng |
|---|---|---|---|
| Guard B | stairwell | 3.0642137 | 101.6170619 |
| Guard A | canteen | 3.0631104 | 101.6163152 |
| Guard C | hostel_corridor | 3.0603973 | 101.6171249 |
| Warden D, off duty | hostel_corridor | none | none |

| Patrol post | Place | lat | lng |
|---|---|---|---|
| P/01 | Block C stairwell | 3.0640148 | 101.6173947 |
| P/02 | DK Senza, corridor L3 | 3.0602164 | 101.6173947 |
| P/03 | Syopz Mall food court | 3.0636530 | 101.6165401 |

**Check on site:**
- Which room is the auditorium? The seed assumes Block A and B. Move the pin if it's elsewhere.
- Confirm that DK Senza is the hostel we want to show.

**Compact on the Live card:** locked, framed on the incident's building. It shows only the alarming pin, the nearest on-duty guard and the dashed route, plus a corner label reading `WHERE · AUDITORIUM, BLOCK A AND B · GUARD B ~40 M AWAY`. "Open the 3D campus" sits under it as a link to `/cameras?cam=<id>`.

---

## 10. Mock files to add or update (`web/public/mock/`)

- `site.json`: real zone names (auditorium 0.5, stairwell 0.8, canteen as "Syopz Mall food court" 0.7, hostel_corridor as "DK Senza corridors" 1.0, sports_court as "Sports pitch" 0.3), plus `staff` with `post` geo, plus `campus: { "center": {…}, "buildings": "/campus/taylors-lakeside-campus.geojson" }`.
- `cameras.json`: the 6 cameras from §8.1 with `source`, `recorded_at` for recordings, `geo`, `people_count`, and `edge_url` (`http://127.0.0.1:8765` to `:8769`; empty for the black one). In mock mode, **compute `black_since` at runtime as now minus 3 days**, so the badge always reads "Black for 3 days".
- `replay.json`: timestamps per the replay rule (tense at t = 0, fight_likely at about 4 s with eta 6, fight at about 10 s). Add `snapshot` and `top_features` per event from `mock-poses.ts`. Rewrite reasons around the model's real signals, as on the canvas. Examples: "Pair moving closer; body motion rising." "Fast whole-body motion while close, for 1.2 s." "Shove: sudden lunge; second person pushed back."
- `events.json`: add `peak_snapshot` to at least 10 incidents. Add `acked_at` to pushed ones, 3 to 9 s after `pushed_at`.
- `plan.json`: `expected_avoided_per_week` 0.75 / 0.6 / 0.45, and `avoided_per_patrol_hour` 0.19 / 0.12 / 0.45.
- `proof.json`: datasets `["RLVS (300 fight, 300 calm)"]`, `n_clips` 600, `clip_auc` 0.876, `clip_recall` 0.82, `clip_precision` 0.80. The precision is derived from 82% recall at 20% false positives on balanced clips, so ask Model B to confirm it. `own_footage_minutes` 0, `lead_time_s` [], `ir_check.frames` 0, `note` "report-v2".
- `public/alarm.mp3`: a short, loud, loopable tone. `public/ir-frame.jpg` is not needed while IR is "not measured".

---

## 11. Backend reality check: API on `main`, 10 Oct

| Contract says | API today | Frontend handling |
|---|---|---|
| `PATCH /events/:id {acked_at}` | `EventPatch` requires `status` and has no `acked_at` | Push page sends `{status: "pushed", acked_at}`. On 422, keep the ack locally and show "Saved on this phone only". Flag it to Web A. |
| `GET /events?since=` returns created **or updated** | Filters by `start_time` only | Also poll `GET /events` with no `since` every 10 s (latest 50) and merge by `incident_id`, so phone acks and other desks' labels show up |
| `POST /cameras/heartbeat`, black after 60 s | No heartbeat route. Offline after 5 min. | Use `online` and `black_since` as returned. Mock covers the demo. |
| `GET /site` has `staff` | No `staff` | Use `event.nearest_staff` for the name. Map posts fall back to mock `site.json`. |
| `PatrolSlot.avoided_per_patrol_hour` | Missing | Compute it: `expected_avoided_per_week / hoursPerWeek`, parsed from `days` and `hours` |
| Status values | Extra `false_alarm` | Display it as dismissed |
| Clips | `/events/:id/clip` can hold cloud URLs | **Never render cloud clip URLs.** Clips play only from that camera's `edge_url`, on site. |
| CUT features | Agent copilot, auth, knowledge, notifications, multi-site routers exist | **No UI for them** (CUT list) |
| `POST /report` | Exists | SHOULD-only "Weekly summary" button on Plan |

Keep the mock fallback for every call, so every route renders with the API down.

---

## 12. Model reality check: `model/REPORT.md` v2

- The live detector outputs **calm, tense and fight** only. **fight_likely, ETA, type and reason are not produced yet.** The UI must handle `eta_seconds: null` ("Watching · no ETA"), a fight with no fight_likely before it, and a generic reason.
- Pose: 12 body keypoints, **no face points**. Copy says "12 body keypoints per person", never 17.
- Lead time, live-room accuracy, false alarms per camera-hour, the CCTV angle and IR are **not measured**. Proof says so. Live's "Warned N s before the shove" is labelled "on this replay" and comes only from the canned replay.

---

## 13. Build order and time boxes

| # | Branch | Work | Time box |
|---|---|---|---|
| 1 | `web/shell-v3` | Rebase scaffold, types v2+v3, tokens, fonts, header, alarm layer, `SkeletonView`, `mock-poses.ts` | 1.5 h |
| 2 | `web/live-v3` | Live: evidence panel (LIVE, REPLAY), card, queue, wall, timestamp replay, handover drawer | 2.5 h |
| 3 | `web/push-v3` | Push: five states, wake lock, audio, `acked_at` | 45 min |
| 4 | `web/cameras` | Cameras grid and detail panel, `?cam=`, with a placeholder slot for the 3D view | 1 h |
| 4b | `web/campus-3d` | 3D campus per `docs/campus-3d-agent-prompt.md`, wired into Cameras, Plan and the Live card. Can run in parallel with a second agent. | 2.5 h |
| 5 | `web/proof-v3` | Proof with the real numbers | 1.5 h |
| 6 | `web/plan-v3` | Plan restyle and corrected maths | 1 h |
| 7 | `web/incidents-v3` | Case review | 1.5 h |
| 8 | `web/polish` | Empty, loading and error states; 390 px pass; favicon; titles | 1 h |

**Frontend cut order if behind:** handover drawer → compact 3D on the Live card → Google tiles (keep the footprint 3D) → REPLAY tab (keep LIVE) → Proof inspector (keep tiles and table) → Cameras detail panel (keep the 3D and grid) → heatmap (keep the slot cards and the 3D plan view).
**Never cut:** Live card with alarm, Confirm and Dismiss · deployed link · Push page · Plan slot cards · Proof page.

---

## 14. Acceptance checklist, before every PR and at the 23:00 checkpoint

- [ ] `npm run build` and `npm run lint` pass.
- [ ] API down (unset or point `NEXT_PUBLIC_API_URL` at nothing): every route renders from mock, and the `MOCK DATA` chip shows.
- [ ] `?replay=1`: amber before red; ETA tracks the wall clock; banner, edge, card and tile pulse at 1 Hz; sound once if armed; toast; the phone on `/push?staff=Guard%20B` goes red within 2 s.
- [ ] Confirm survives the next poll. Silence stops sound and pulse but keeps the banner.
- [ ] Every row of the click map in §5 works.
- [ ] Reduced motion: no pulse, static red.
- [ ] 390 px phone: no horizontal page scroll; Live stacks with the card first; the heatmap scrolls inside its box.
- [ ] Remote view (Vercel) never requests an `edge_url` and never renders a video or stream element.
- [ ] On laptop 1, the live webcam and the 4 recording streams play, and each falls back to skeletons when its stream drops.
- [ ] Every recording shows `REC` and its recording time. Nothing recorded is ever labelled live.
- [ ] No video file is committed anywhere in `web/`, and no screen shows a stock clip.
- [ ] 3D campus: footprints render with no key; the real campus renders with a key; clicking the auditorium opens the live feed; the plan layer shows 3 posts; the Live card shows the compact view.
- [ ] No "student" or "school" in the chrome. Zone names come from `site.json`.
- [ ] Proof shows no number without a source.
- [ ] The integration tests in `docs/work-split.md` §4 pass against the deployed link.

---

## 15. Copy deck

| Where | Exact text |
|---|---|
| Live strip | NO CAMERA CONNECTED · "Showing the recorded demo feed from the auditorium webcam, played in real time. When the laptop webcam is on, this is live." · Restart demo feed |
| Source labels | `LIVE WEBCAM` · `RECORDING · LOOP` · `NO SIGNAL` · tile suffix `· LIVE` / `· REC` · "Recording made Sat 10 Oct 16:20, looping" |
| 3D footer | "Footprints © OpenStreetMap contributors · heights estimated · drag to rotate". In Google tiles mode, add Google's required attribution. |
| Evidence footnote | "The three signals the model leans on most, plus its score. Pose: 12 body keypoints per person, no face points." |
| Calm card | "Nothing to do. Chats, hugs and high-fives stay calm by design." |
| Tense card state | "Not pushed; tense is silent" |
| Decision row | "Confirmed: real incident" / "Dismissed: false alarm" · "Saved as a label for this camera." · Undo |
| Toast | "Pushed to Guard B · 14:31:06" · "One person only. They see a skeleton snapshot, not video." |
| Queue footnote | "Priority = severity × confidence × zone risk × people. Zone risk comes from this site's zone table." |
| Plan assumption | "60% of hotspot incidents are avoided when a person is present. Stated, not measured. Avoided = incidents in 4 weeks × 0.6." |
| Hotspot rule | "3 or more incidents in one place, in the same hour of the week, within 4 weeks." |
| Incidents label rule | "The desk's Confirm or Dismiss is the label. The phone tap only records 'on my way'." |
| Remote frame | "NO PIXELS LEAVE THE SITE · 12 BODY KEYPOINTS PER PERSON" |
| Clip line, on site | "10 s clip on the edge laptop · auto-deletes after [N] days · never uploaded". Ask Model A for N. |
| Push timeout | "No answer in 10 s. The desk can see you did not answer and will call you by radio." |
| Proof banner | "Dataset numbers are real, from 600 public RLVS clips. Live room, CCTV angle, lead time and night are not measured yet, and this page says so." |
| We do not claim | "Early warning before a shove, until lead time is measured." · "Any live-room accuracy or false-alarm rate yet." · "Verbal or online bullying. Night or IR. Weapons." |
