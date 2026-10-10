# Prompt for the 3D campus agent

Paste everything below the line into a Claude Code session opened in `~/Projects/earlyeye`.

---

You are rebuilding the 3D campus in the EarlyEye dashboard (web/) as a hand-built, detailed 3D miniature of Taylor's University Lakeside Campus. Style: a stylised diorama like an isometric low-poly city illustration, with chunky buildings that have windows, floors and roofs, plus trees, lamp posts, roads and small cars, all on a floating base against a pale sky. It replaces the Google Photorealistic 3D Tiles view. Nothing is rendered from Google Maps.

WHAT KAYLA WANTS
1. Only Taylor's. Model the campus inside its real boundary (OpenStreetMap way 210350320) and nothing else: no neighbouring housing, highway, river or hills. The campus sits on its own floating base, cut along the real boundary.
2. Detailed, recognisable buildings: Taylor's real layout, shapes, colours and materials, drawn in a clean stylised 3D style. Not plain extruded boxes, and not Google's photo mesh.

WHERE THE CODE IS
- web/src/components/campus3d/ (campus3d.tsx, overlays.tsx, model.ts, theme.ts, flat-map.tsx). Find the newest version with `git log --all --oneline -- web/src/components/campus3d`, branch from it as web/campus-diorama, and rebase on origin/main.
- Keep the component API, the overlays (pins, guard chips, cards, layer toggle, jump chips, nav controls, legend) and the data model. Replace only the rendering.
- Data: design/assets/taylors-lakeside-campus.geojson (footprints, campus boundary, lake, pitches) and design/assets/campus-3d-seed.json (cameras, guards and patrol posts in lat/lng). Convert lat/lng to local metres (east, north) around the campus centre 3.0631104, 101.6169899.

ENGINE
- three.js with @react-three/fiber and @react-three/drei (approved). Load it with dynamic(..., { ssr: false }) so it never slows Live's first paint.
- Remove the Google Tile3DLayer and every use of NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. Remove deck.gl if nothing else uses it.
- Build all geometry in code from the footprints. No downloaded 3D models, and no tiles, textures or photos from Google or anyone else in the repo.
- Instance repeated parts (windows, solar panels, trees, lamp posts, cars, parking bays) and merge static geometry. Target under about 150k triangles and a smooth 60 fps orbit on a laptop. Render on demand, animating only while the camera moves or an alarm pulses.

GETTING IT RIGHT: THE REAL TAYLOR'S
- Study the real campus as visual reference only: Google Earth 3D and Street View around 3.0631, 101.6170, plus Taylor's own photos and facilities page (https://university.taylors.edu.my/en/study/campus-facilities.html). Read each building's shape, height, colours, materials and signature details from them. Never render, trace or ship that imagery.
- Write what you saw in web/src/components/campus3d/reference.md, one row per building: floors, wall colour, glass, roof, signature details, and which source you looked at. Kayla checks this table.
- Layout comes from the OSM footprints. Heights come from floor counts at about 4 m a floor. Taylor's lists rooms up to Level 8 in Blocks C, D and E. Count the other buildings on Street View.
- Model the signature details you can confirm on the imagery: for example rooftop solar-panel arrays, a coloured tensile canopy, patterned plaza paving by the lake, the entrance roundabout, glass curtain walls and covered walkways. Model only what you have confirmed.
- Names come from Taylor's pages and the seed: Block A and Block B (the Grand Hall is in Block B, Level 2), Block C, Block D, Block E, Syopz Mall with U Residence above it, Sports centre, Lake, Tennis courts and Football pitch. Never invent a building, name or floor. If you're unsure what something is, model it plainly and leave it unlabelled.

LOOK: THE REFERENCE ILLUSTRATION'S STYLE, WITH TAYLOR'S REAL COLOURS
- Floating base: extrude the campus boundary as a slab about 10 m thick with a softly rounded top edge. The top is lawn and paving, and the sides are a warm soil tone. Put a soft shadow under it and a pale sky gradient behind it. Draw nothing outside the boundary.
- Buildings: real wall colours, floor lines, window rows or curtain-wall glass, parapets, rooftop plant rooms and solar panels, entrance canopies, slight bevels, and a soft ambient-occlusion feel.
- Ground: internal roads with lane markings and kerbs, car parks with bay lines and a few low-poly cars, footpaths and plazas, lawns, trees along the roads and the lake shore, lamp posts and a few benches.
- Lake: slightly recessed, calm pale blue, with a lighter shore line. Pitches carry their line markings.
- Lighting: one warm key light with soft shadows, plus a hemisphere fill. The result should look bright, clean and slightly matte, like a miniature.
- Keep the model's colours muted, so the UI's red alarm highlight and blue patrol columns always stand out. If a real feature is red, keep its hue but desaturate it slightly.

BEHAVIOUR: SAME AS THE CURRENT COMPONENT
- Camera: a narrow perspective (FOV 25–30°) or an orthographic view. The opening view frames the whole island at about 45° tilt with the lake in front. Orbit within limits: never under the base, never zoomed far out. Controls: rotate ±20°, Top, Tilt, + and −, Reset view, and a compass.
- Jump chips (Grand Hall, Block C, Syopz Mall, U Residence, Sports centre, Whole campus) fly the camera there in 800 ms, or instantly under prefers-reduced-motion.
- Cameras layer: pins are HTML buttons anchored to 3D points with drei <Html>, and are hidden when a building is in front of them. LIVE is red, REC grey and NO SIGNAL ink. Clicking a building or a pin opens the existing camera card.
- Alarm: the alarming building gets a pulsing red outline and its pin gets ee-pulse. A dashed blue 3D line runs from the nearest on-duty guard to the alarming camera.
- Plan layer: patrol post pins plus blue columns, with height = incidents_4w × 9 m.
- Compact view on the Live card: the same model, locked and framed on the alarming building (the Grand Hall by default), with the WHERE label.
- No WebGL: keep the flat 2D map.
- Credit line: "Stylised model · footprints © OpenStreetMap contributors".

CHECKS BEFORE THE PR
- Screenshots of the whole island, close-ups of Blocks A to E, Syopz Mall and U Residence, and the sports area, plus the Live compact card and the Plan layer. Put a Google Earth screenshot taken from the same angle beside the whole-island shot so Kayla can compare the layout. That screenshot goes only in the PR, never in the repo.
- Nothing outside the campus boundary is drawn.
- Every pin sits on its real spot: the Grand Hall (Block B, Level 2), the Block C stairwell, the Syopz Mall food court, U Residence above Syopz, and the football pitch by the sports centre.
- npm run build and npm run lint pass. Check /, /cameras and /plan at 1440 px and 390 px with the API down.
- In the same PR, replace docs/campus-3d-agent-prompt.md with this prompt, and update brief §9 to say "stylised 3D model built from the real footprints; no Google tiles".

RULES
- Only touch web/, design/assets/, docs/campus-3d-agent-prompt.md and docs/frontend-build-brief.md. Never edit edge/, api/, model/ or data/.
- One PR with a 5-line description and the screenshots. No Co-Authored-By trailers or "Generated with" footers.
- Ask Kayla before adding any dependency beyond three, @react-three/fiber and @react-three/drei.
