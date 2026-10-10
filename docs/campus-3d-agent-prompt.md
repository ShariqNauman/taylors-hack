# Prompt for the 3D campus agent

Paste everything below the line into a Claude Code session opened in `~/Projects/earlyeye`, after the shell branch (`web/shell-v3`) has merged.

---

You are building the **3D campus** for the EarlyEye dashboard (`web/`, Next.js 15, Tailwind 4, shadcn). I'm Kayla, owner of `web/`. Mentors asked for a visual map. Judges should see the **real Taylor's University Lakeside Campus** in 3D, look around it like Google Maps 3D, click a building, and land on that camera's feed. One room, the **Grand Hall**, has our **live laptop webcam**. The other cameras play **our own labelled recordings**.

## Rule zero: it must be the real Taylor's University

This is the one thing you can't get wrong. Judges are standing on this campus.

- **The place:** Taylor's University Lakeside Campus, No. 1 Jalan Taylor's, 47500 Subang Jaya, Selangor. Centre at **3.06311, 101.61699**, which is OpenStreetMap way 210350320.
- **Any data source is fine** (Google Photorealistic 3D Tiles, Google Maps, OpenStreetMap) as long as what renders is the real campus, at the real coordinates, with the real buildings in the real places.
- **Never** use a generic or sample campus, a stock 3D model, AI-generated buildings, or shapes drawn by eye. Never invent a building, a name, a room or a floor.
- **Which source wins:**
  1. **Shape, position and height:** Google Photorealistic 3D Tiles and Google Maps satellite.
  2. **Names, rooms and floors:** Taylor's own [campus facilities page](https://university.taylors.edu.my/en/study/campus-facilities.html) and [hostel pages](https://taylorshostel.taylors.edu.my/accommodations/on-campus/ruemz).
  3. **Footprints for the fallback:** OpenStreetMap, already in `design/assets/taylors-lakeside-campus.geojson`.
- If two sources disagree, follow that order, write the difference in the PR, and tell me. If something isn't in any source, use a plain label such as "Sports centre", or ask me.

**What is really there**, already checked against those sources:

| Building (OpenStreetMap name) | What it holds | Notes |
|---|---|---|
| Block A and Block B | The **Grand Hall**, Block B Level 2, 1,000 seats. Our live webcam room. | One OSM footprint for both blocks |
| Block C, Block D, Block E | Lecture theatres on Levels 1 and 2, rooms up to Level 8 | Block C stairwell is our top hotspot |
| Syopz Mall | Shops, food court, gym. **U Residence** and **Ruemz**, the two on-campus hostels, sit above the mall. | One OSM footprint; find the residence tower on the Google tiles |
| Sports centre | Tagged as a sports centre in OSM, without a name. Tennis courts and a football pitch beside it. | |
| Lake | The lake the campus is built around | |

**DK Senza is not Taylor's.** It's a private condominium south of the campus, so don't show it. The hostel cameras are in U Residence.

## Read first

1. `docs/frontend-build-brief.md`. §3 covers tokens, §8 cameras and video, and §9 the 3D campus, including the ground-truth rules above.
2. `design/canvas/Campus3D.dc.html`. This is the interaction prototype: layers, pins, posts, info card, controls and compact mode. Copy its behaviour and copy text. Its rendering is a hand-rolled projection, so don't copy that part.
3. `design/assets/taylors-lakeside-campus.geojson`. These are real footprints from OpenStreetMap (ODbL), with what each building contains. `height_m_estimate` is our guess.
4. `design/assets/campus-3d-seed.json`. It holds the latitude and longitude for every camera, on-duty post and patrol post, plus each camera's source (`live`, `recorded` or `black`). The positions are placed by hand. You must check them (see "Verify").

## Build it with deck.gl

Packages: `@deck.gl/react`, `@deck.gl/core`, `@deck.gl/layers`, `@deck.gl/geo-layers`, `@deck.gl/extensions`, `@loaders.gl/3d-tiles`. Use a client component loaded with `dynamic(..., { ssr: false })`. One engine handles two looks:

1. **Real 3D, the default when a key exists:** Google Photorealistic 3D Tiles via `Tile3DLayer`, from `https://tile.googleapis.com/v1/3dtiles/root.json`.
   - The key comes from `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, sent as the `X-GOOG-API-KEY` header in `loadOptions.fetch`.
   - The key needs the Map Tiles API enabled, and it must be **restricted by HTTP referrer** to the Vercel domain and localhost.
   - Ask me for the key. **Never commit it.**
   - Show Google's logo and the tile attributions as the terms require. Don't cache tiles beyond what the terms allow.
   - If `Tile3DLayer` can't load the tiles, Google's own 3D map element in the Maps JavaScript API is an acceptable swap. The pins, cards and fallback must behave the same. Ask me before switching.
2. **Footprint 3D, the fallback:** a `GeoJsonLayer` with `extruded: true` and `getElevation` from `height_m_estimate`, in the Light Console colours: white tops, `#E6E9EE` and `#C9D0D9` sides, a `#F7F8FA` ground and `#D6E3F1` water.
   - Use it when there's no key, when tiles haven't loaded within 5 s, or in mock mode.
   - The compact map on Live **always** uses this look, because it is lighter.
   - Credit "© OpenStreetMap contributors".

## Component API

In `web/src/components/campus3d/`:
```ts
<Campus3D
  mode="cameras" | "plan"
  compact?: boolean            // Live card: locked view, no controls, no info card
  focusCameraId?: string       // compact and deep links: frame this camera's building
  cameras={Camera[]} site={Site} events={Event[]} plan={PatrolPlan}
  onOpenCamera?(id)            // navigate to /?cam= or /cameras?cam=
/>
```

## Behaviour, matching the prototype

- **Initial view:** centred on the campus, pitch about 50°. Choose the bearing so the north–south long axis runs across the screen.
- **Navigation:** drag rotates and tilts, wheel or pinch zooms. Buttons for rotate ±20°, Top, Tilt, + and −, Reset view, and a compass. "Jump to" chips (Grand Hall, Block C, Syopz Mall, U Residence, Sports centre, Whole campus) fly there in 800 ms, or instantly under `prefers-reduced-motion`.
- **Cameras layer:**
  - A **pin per camera** at `camera.geo`, as a real `<button>`. Render pins as HTML overlays projected with `viewport.project`, so they stay accessible.
  - Pin style: a red dot plus "LIVE" for the webcam, a grey dot plus "REC" for recordings, ink for black.
  - The camera of the current fight_likely or fight incident gets `ee-pulse` and a red border, and its building is tinted `#FDEDEB` with a `#C8241B` outline.
  - On-duty guards appear as blue person chips. A dashed blue path (`PathStyleExtension`) runs from the nearest on-duty post to the alarming camera.
- **Click a building** (pick the footprint layer; draw it invisibly over Google tiles so it can be picked) or **a pin** to open the info card:
  - A source chip: `LIVE WEBCAM`, `RECORDING · LOOP` or `NO SIGNAL`.
  - Location, building and floor, using the real names from the seed.
  - **The feed.** On site: `<img src={camera.edge_url + '/stream.mjpg'}>`, and recordings come through their own edge process the same way. Remote: `<SkeletonView>` from the latest `snapshot`, or "N people in view".
  - Level chip, people count, and the buttons **Open live view** (or **Play recording in Live**) and **Camera details**.
- **Plan layer:** a patrol post pin per slot showing `P/01 · MON–THU 13:00–14:00`, plus a blue `ColumnLayer` at the post with height = `incidents_4w × 9 m`. Clicking opens a card with incidents in 4 weeks, avoided per week, hours per week, rationale, **Open in Plan** and **See the incidents**.
- **Compact:** a locked camera framing the focused building, showing only the alarming pin, the nearest guard and the route. A corner label reads `WHERE · GRAND HALL, BLOCK B LEVEL 2 · GUARD B ~40 M AWAY`. Show "Open the 3D campus" as a link under it, not inside it.

**Where it goes:**
- `/cameras`: full, cameras layer, above the grid.
- `/plan`: full, plan layer, above the slot cards.
- `/` (Live): compact, inside the alert card.

`?cam=<id>` preselects a camera.

## Verify against the real campus before every PR

1. Open Google Maps at 3.06311, 101.61699 in satellite view and in 3D. Set our view to the same bearing and tilt. Put both screenshots side by side in the PR.
2. Every building in our view sits where Google shows it, with the same outline, to within a few metres. Nothing extra, nothing missing among the buildings listed above.
3. Every pin sits on the right real spot:
   - the Grand Hall in Block B,
   - the Block C stairwell,
   - the Syopz Mall food court,
   - the U Residence tower above Syopz,
   - the football pitch by the sports centre.
4. If a seed position is off, fix it in `campus-3d-seed.json` and list the change in the PR.
5. Fallback heights: set each building's height from the Google tiles, or by counting floors at about 4 m each, and update `height_m_estimate`. Keep the "heights estimated" credit if any height is a guess.
6. Every name on screen appears in Taylor's own pages or in OpenStreetMap.

## Rules

- Light theme, Light Console tokens, and no other motion than flyTo and the alarm pulse.
- The remote link never loads an `edge_url`.
- Recordings are always labelled REC with their recording time.
- If WebGL is unavailable, show the footprint layer as a flat top-down 2D view.
- Keep the 3D code out of the initial bundle. It must not slow Live's first paint.

## Acceptance

1. With no key, footprints render in 3D within 2 s on a laptop.
2. With a key, the real campus renders, and the side-by-side screenshots with Google Maps show the same campus from the same angle.
3. Every pin is on the right real building, and every name matches Taylor's own pages.
4. Clicking the Grand Hall shows the live webcam on site and live skeletons remote.
5. Every pin and chip is keyboard-reachable with a visible focus ring.
6. `npm run build` passes, and the 3D chunk is lazy-loaded.
7. Works at 390 px: the controls wrap and the card becomes a bottom sheet.

## Ask me

- For the Google Maps API key.
- Which room the demo laptop will film on pitch day. The seed uses the Grand Hall. If it's a lecture theatre, move `CAM-AU-01` to that block and rename it.
- Anything where the sources disagree.

Branch `web/campus-3d`, one PR, 5-line description with the side-by-side screenshots. No `Co-Authored-By` trailers.
