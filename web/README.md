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
