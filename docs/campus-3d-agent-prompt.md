# Prompt for the 3D campus agent

Paste everything below the line into a Claude Code session opened in `~/Projects/earlyeye`, after the shell branch (`web/shell-v3`) has merged.

---

You are building the **3D campus** for the EarlyEye dashboard (`web/`, Next.js 15, Tailwind 4, shadcn). I'm Kayla, owner of `web/`. Mentors asked for a visual map. Judges should see the **real Taylor's University Lakeside Campus** in 3D, look around it like Google Maps 3D, click a building, and land on that camera's feed. One building, the auditorium, has our **live laptop webcam**. The other cameras play **our own labelled recordings**.

**Read first:**
1. `docs/frontend-build-brief.md`. §3 covers tokens, §8 cameras and video, and §9 the 3D campus.
2. `design/canvas/Campus3D.dc.html`. This is the interaction prototype: layers, pins, posts, info card, controls and compact mode. Copy its behaviour and copy text. Its rendering is a hand-rolled projection, so don't copy that part.
3. `design/assets/taylors-lakeside-campus.geojson`. These are real footprints from OpenStreetMap (ODbL): Block A and B, Block C, D, E, Syopz Mall, the sports centre, DK Senza, the lake and the pitches. `height_m_estimate` is our guess.
4. `design/assets/campus-3d-seed.json`. It holds the latitude and longitude for every camera, on-duty post and patrol post, plus each camera's source (`live`, `recorded` or `black`).

**Build it with deck.gl:** `@deck.gl/react`, `@deck.gl/core`, `@deck.gl/layers`, `@deck.gl/geo-layers`, `@deck.gl/extensions`, `@loaders.gl/3d-tiles`. Use a client component loaded with `dynamic(..., { ssr: false })`. One engine handles two looks:

1. **Real 3D, the default when a key exists:** Google Photorealistic 3D Tiles via `Tile3DLayer`, from `https://tile.googleapis.com/v1/3dtiles/root.json`.
   - The key comes from `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, sent as the `X-GOOG-API-KEY` header in `loadOptions.fetch`.
   - The key needs the Map Tiles API enabled, and it must be **restricted by HTTP referrer** to the Vercel domain and localhost.
   - Ask me for the key. **Never commit it.**
   - Show Google's logo and the tile attributions as the terms require. Don't cache tiles beyond what the terms allow.
2. **Footprint 3D, the fallback:** a `GeoJsonLayer` with `extruded: true` and `getElevation` from `height_m_estimate`, in the Light Console colours: white tops, `#E6E9EE` and `#C9D0D9` sides, a `#F7F8FA` ground and `#D6E3F1` water.
   - Use it when there's no key, when tiles haven't loaded within 5 s, or in mock mode.
   - The compact map on Live **always** uses this look, because it is lighter.
   - Credit "© OpenStreetMap contributors".

**Component API**, in `web/src/components/campus3d/`:
```ts
<Campus3D
  mode="cameras" | "plan"
  compact?: boolean            // Live card: locked view, no controls, no info card
  focusCameraId?: string       // compact and deep links: frame this camera's building
  cameras={Camera[]} site={Site} events={Event[]} plan={PatrolPlan}
  onOpenCamera?(id)            // navigate to /?cam= or /cameras?cam=
/>
```

**Behaviour**, matching the prototype:
- **Initial view:** centred on the campus, pitch about 50°. Choose the bearing so the north–south long axis runs across the screen.
- **Navigation:** drag rotates and tilts, wheel or pinch zooms. Buttons for rotate ±20°, Top, Tilt, + and −, Reset view, and a compass. "Jump to" chips (Auditorium, Block C, Syopz Mall, Sports centre, DK Senza, Whole campus) fly there in 800 ms, or instantly under `prefers-reduced-motion`.
- **Cameras layer:**
  - A **pin per camera** at `camera.geo`, as a real `<button>`. Render pins as HTML overlays projected with `viewport.project`, so they stay accessible.
  - Pin style: a red dot plus "LIVE" for the webcam, a grey dot plus "REC" for recordings, ink for black.
  - The camera of the current fight_likely or fight incident gets `ee-pulse` and a red border, and its building is tinted `#FDEDEB` with a `#C8241B` outline.
  - On-duty guards appear as blue person chips. A dashed blue path (`PathStyleExtension`) runs from the nearest on-duty post to the alarming camera.
- **Click a building** (pick the footprint layer; draw it invisibly over Google tiles so it can be picked) or **a pin** to open the info card:
  - A source chip: `LIVE WEBCAM`, `RECORDING · LOOP` or `NO SIGNAL`.
  - Location, building and floor.
  - **The feed.** On site: `<img src={camera.edge_url + '/stream.mjpg'}>`, and recordings come through their own edge process the same way. Remote: `<SkeletonView>` from the latest `snapshot`, or "N people in view".
  - Level chip, people count, and the buttons **Open live view** (or **Play recording in Live**) and **Camera details**.
- **Plan layer:** a patrol post pin per slot showing `P/01 · MON–THU 13:00–14:00`, plus a blue `ColumnLayer` at the post with height = `incidents_4w × 9 m`. Clicking opens a card with incidents in 4 weeks, avoided per week, hours per week, rationale, **Open in Plan** and **See the incidents**.
- **Compact:** a locked camera framing the focused building, showing only the alarming pin, the nearest guard and the route. A corner label reads `WHERE · AUDITORIUM, BLOCK A AND B · GUARD B ~40 M AWAY`. Show "Open the 3D campus" as a link under it, not inside it.

**Where it goes:**
- `/cameras`: full, cameras layer, above the grid.
- `/plan`: full, plan layer, above the slot cards.
- `/` (Live): compact, inside the alert card.

`?cam=<id>` preselects a camera.

**Rules:**
- Light theme, Light Console tokens, and no other motion than flyTo and the alarm pulse.
- The remote link never loads an `edge_url`.
- Recordings are always labelled REC with their recording time.
- If WebGL is unavailable, show the footprint layer as a flat top-down 2D view.
- Keep the 3D code out of the initial bundle. It must not slow Live's first paint.

**Acceptance:**
1. With no key, footprints render in 3D within 2 s on a laptop.
2. With a key, the real campus renders, and Block C, Syopz Mall and the lake sit in the right places under the pins.
3. Clicking the auditorium shows the live webcam on site and live skeletons remote.
4. Every pin and chip is keyboard-reachable with a visible focus ring.
5. `npm run build` passes, and the 3D chunk is lazy-loaded.
6. Works at 390 px: the controls wrap and the card becomes a bottom sheet.

**Open questions for Kayla:**
- Which room is the auditorium? The seed puts it in Block A and B.
- Is DK Senza the right hostel to show?
- The building heights are estimates. Should we adjust them by eye against the Google tiles?

Branch `web/campus-3d`, one PR, 5-line description with screenshots. No `Co-Authored-By` trailers.
