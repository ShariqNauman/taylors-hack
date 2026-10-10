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

The real Taylor's University Lakeside Campus (3.06311, 101.61699) in deck.gl, on `/cameras` (camera pins), `/plan` (patrol posts) and inside the Live alert card (compact). Loaded with `next/dynamic`, so it is not in the first paint.

- **Real 3D:** Google Photorealistic 3D Tiles when `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is set (Map Tiles API enabled, key restricted by HTTP referrer to the Vercel domain and localhost). Never commit the key. Google's logo and the tile attributions are shown as the terms require.
- **Fallback:** the OpenStreetMap footprints in `public/campus/taylors-lakeside-campus.geojson`, extruded with estimated heights. Used with no key, when tiles have not loaded within 5 s, in compact mode, and in a browser without WebGL (flat top-down).
- **Seed:** `public/campus/campus-3d-seed.json` holds every camera, on-duty post and patrol post position, placed on the footprints. Names and floors come from Taylor's own pages; footprints are © OpenStreetMap contributors (ODbL).
- `?cam=<id>` on `/cameras` and `?slot=P/01` on `/plan` preselect a pin. `?view=onsite` lets the card load `<edge_url>/stream.mjpg`; the remote link never requests an `edge_url`.
