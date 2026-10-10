# design/

Design source for the EarlyEye dashboard, exported from the design canvas on 10 Oct 2026.

- **Canvas (live, private):** https://claude.ai/artifact/5y7ejPL72MDUJgZp9xNr47. Ask Kayla to share it if you can't open it.
- **Build spec:** `docs/frontend-build-brief.md`. Read that first. These files are the visual reference behind it.

## What is in `canvas/`

| Files | Status | What |
|---|---|---|
| `L3Tokens`, `L3Live`, `L3Cameras`, `L3Incidents`, `L3Plan`, `L3Proof`, `L3Push` | **Build target (v3 Light Console)** | Final screens. Interactive: replay, alarm pulse, 3D campus, handover drawer, links between screens. |
| `Main`, `Blueprint`, `JourneyOperator`, `JourneyResponder`, `JourneyManager`, `JourneyBuyer` | Research | User segmentation, the incident end to end, one journey per role |
| `V2Proposal`, `V2*` | Superseded | Dark "Ops Console" direction, with the competitor read of Ambient.ai, Volt and ZeroEyes. Kept for reference. |
| `Live`, `Plan`, `Incidents`, `Proof`, `Push`, `DesignSystem`, `Components` | Superseded | v1 "Daylight Desk". Kept for reference. |
| `canvas.json` | Index | Artboard positions and titles |

`Campus3D.dc.html` is the 3D campus component used inside `L3Cameras`, `L3Plan` and `L3Live` through `<dc-import>`. It is an interaction reference only: the real build uses deck.gl, per `docs/campus-3d-agent-prompt.md`.

`assets/taylors-lakeside-campus.geojson` holds the real building footprints of Taylor's University Lakeside Campus from OpenStreetMap (© OpenStreetMap contributors, ODbL; heights estimated). `assets/campus-3d-seed.json` holds the latitude and longitude of every camera, on-duty post and patrol post.

## How to read a `.dc.html` file

Each file is one artboard written as a Design Component. They only render inside the canvas, because `./support.js` is the canvas runtime and is not in this repo. Read them as source:

- **Markup** sits inside `<x-dc>…</x-dc>`. All styling is inline `style="…"`, which gives you exact sizes, colours and spacing to port to Tailwind.
- `{{name}}` is a value computed in the script's `renderVals()`. `<sc-for list="{{items}}" as="item">` is a loop and `<sc-if value="{{flag}}">` is a conditional.
- `onClick="{{handler}}"` points to a function returned by `renderVals()`. The click behaviour is in that script.
- The `<script type="text/x-dc">` block at the bottom holds the logic, as a React-like class with `state`, `setState` and `renderVals()`. In `L3Live`, the pose generator `fig()` and the tables `PA` and `PB` are what `web/src/lib/mock-poses.ts` should port.
- `<a href="L3Cameras.dc.html">` links map to routes: `L3Live` is `/`, `L3Cameras` is `/cameras`, `L3Incidents` is `/incidents`, `L3Plan` is `/plan`, `L3Proof` is `/proof`, `L3Push` is `/push`.

Prototype-only controls do not ship as shown: the On-site / Remote toggle (in production this is auto-detected, see brief §8), "Send a test push", and the canvas Tweaks.
