# EarlyEye dashboard (`web/`)

Next.js 15 App Router + TypeScript + Tailwind + shadcn/ui + Recharts. Deployed on Vercel.

```bash
npm install
npm run dev        # http://localhost:3000
npm run build
```

- `NEXT_PUBLIC_API_URL` points at the FastAPI service. When unset (or the API is down) every screen renders from `public/mock/*.json` through `/api/mock/[name]`.
- `/?replay=1` cycles the canned escalation in `public/mock/replay.json` through the live queue at 0.5 s per event.
- Contract: `src/lib/types.ts` mirrors `docs/kayla-frontend-plan.md`. Change the doc in the same commit as the type.

## 3D campus (`src/components/campus3d/`)

A stylised 3D model of the real Taylor's University Lakeside Campus (3.06311, 101.61699), built in code from the OpenStreetMap footprints with three.js (react-three-fiber + drei), on `/cameras` (camera pins), `/plan` (patrol posts) and inside the Live alert card (compact). Loaded with `next/dynamic`, so it is not in the first paint. No Google tiles, no downloaded models, no textures.

- **Data:** `public/campus/taylors-lakeside-campus.geojson` (footprints, boundary, lake, pitches), `public/campus/taylors-lakeside-ground.geojson` (roads, car parks, lawns) and `public/campus/campus-3d-seed.json` (camera, guard and patrol-post positions). Footprints © OpenStreetMap contributors (ODbL); names and floors from Taylor's own pages.
- **What each building looks like and why:** `src/components/campus3d/reference.md`.
- **Behaviour:** drag rotates and tilts within limits, wheel zooms; jump chips fly in 800 ms; `?cam=<id>` on `/cameras` preselects a pin; the remote link never requests an `edge_url`. Without WebGL the same footprints render as a flat map.
