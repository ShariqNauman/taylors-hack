# KiraKira — Dormathon 2026, Track 1 (Predictive Model)

Read this first. Full plans are in `docs/`; this file is the summary that every session needs.

## Hard facts
- Event: Dormathon 2026, Taylor's University branch. Build Sat 10 Oct 13:00 → **submit Sun 11 Oct 08:30** (hard buffer 09:00, deadline 09:30).
- Submission: **public GitHub + deployed app link + slides PDF + team name/branch**. The deployed link is non-negotiable; deploy hello-world before any feature.
- Pitch: Phase 1 = 3 min + 2 min Q&A in person. Phase 2 (top 18) = 4 min + 3 min Q&A over video call. Demo from the deployed link; backup video in repo.
- Rubric (judges' words): every solution must **Detect, Categorize, Prioritize, Explain**. Strong = specific real problem, clear user, supports decisions, robust on noisy/unfamiliar data, minimizes false alarms, measurable impact with realistic assumptions. Core question: **"Does your model help someone make a better decision, and can you prove it?"**

## The product (one paragraph)
KiraKira: a credit score for your customers, built from your own invoices. Every Malaysian business >RM500k turnover files every invoice to LHDN (MyInvois) since Jul 2026. We read that flow + the ledger, predict per invoice P(late) and days late, rate each customer Good/Average/Bad, rank who to chase today by ringgit at risk (max 5/day), explain why in one BM/EN sentence (SHAP → template → Claude polish), read a Manglish WhatsApp reply into a dated promise, project cash 90 days, and when it dips, rank the cheapest fix with an apply-by date (chase → TEKUN → BSN → invoice financing → card; never ah long). Proof page inside the app.

Framing on stage, in this order: *not fraud detection* → *supply-chain anomaly detection for the money* → *data rail is MyInvois, not Kaggle*.

Persona: Ah Seng, printing shop, Kajang, RM65k/month (inside MyInvois Phase 5), one corporate customer (Syarikat ABC) always 30+ days late.

## Stack
- `web/` Next.js 15 App Router + TS + Tailwind + shadcn/ui + Recharts → **Vercel**. Reads `NEXT_PUBLIC_API_URL`; falls back to `/api/mock/*` serving `public/mock/*.json`.
- `api/` Python 3.11 FastAPI + pandas → **Render**. Endpoints: `GET /invoices /customers /projection /proof`, `POST /promise`, (SHOULD) `POST /parse-buku /ask`.
- `model/` LightGBM classifier (late) + regressor (days late), sklearn baseline + isotonic calibration, SHAP. One `features.py` for both training and demo data. `export_predictions.py` writes JSON into `web/public/mock/` (fallback if Render fails; decide 06:00).
- Claude `claude-sonnet-5-5` via `anthropic` SDK: reads text/images and polishes sentences only. **Never in the prediction path.**
- `data/` CSV/JSON in repo, no DB. Real Kaggle AR dataset for training; simulated Ah Seng book in MyInvois-ish JSON + settlements CSV for demo; `my_calendar_2026_27.csv`; `ladder_rungs.csv`.
- Secrets only in Vercel/Render env vars. `grep -r sk-ant` before the repo goes public.

## Non-negotiable modelling rules
- Time-based split AND hold-out-customers split (GroupKFold). Never random.
- Censoring: label only invoices settled by cutoff or ≥30 days past due at cutoff; drop the rest.
- Customer features and 12-month rating computed strictly as of each invoice's issue date.
- Tune chase threshold on a validation slice (precision ≥ 0.7 on chase bucket). Action table thresholds are placeholders until then.
- Policy backtest: top-5 daily list by model vs largest-first vs oldest-first vs random, % of late ringgit covered. State on the proof page that this measures coverage, not recovery.
- Never quote accuracy on the demo book; its patterns are planted.

## Scope
- MUST: chase list · invoice detail (SHAP + action + customer note) · payer rating · promise-to-pay · cash projection · money ladder · proof page.
- Build order: chase list → **proof page** → invoice detail → cashflow/ladder → rating → promise-to-pay.
- SHOULD (only after 23:00 checkpoint): buku 555 photo → transactions; "can I afford it?" Q&A.
- CUT: GrantCheck, WhatsApp bot (one mockup image), multi-business, contagion graph (slide only), auth, dark mode, i18n toggle.
- Cut order if behind: SHOULD → best-time-to-chase → ladder to 3 rungs → promise-to-pay. Never cut the proof page.

## Checkpoints
13:00 contract locked + both hello-worlds deployed and opened on a phone on mobile data · 19:00 backtest numbers exist, Home renders from mock · 23:00 end-to-end on the deployed link · 03:00–05:00 run-throughs + record demo video · 06:00 live-API vs precomputed decision · 08:00 freeze · **08:30 submit**.

## Docs
- `docs/kirakira-TEAM-FINAL.md` — full team plan: features, logic (rating/categorize/prioritize/action tables), data plan, roles, timeline, pitch script, Q&A, checklist, risks.
- `docs/kayla-frontend-plan.md` — frontend: TypeScript contract (`Invoice`, `Customer`, `Projection`, `Proof`), screens in build order, repo layout, timeline.
- `docs/kirakira-research-and-pivot.md` — judges and sponsor, Malaysian stats with URLs, MyInvois facts, local competitors, US/China inspiration, ladder rung figures, promise-to-pay spec, honesty lines.
- `docs/kirakira-review.md` — external review whose fixes are already applied to the plan.

## Working style for this repo
- Match the contract in `docs/kayla-frontend-plan.md` exactly; if a field must change, change the doc first.
- Every screen must render with the API down (mock fallback).
- Light theme only, one idea per screen, `Intl.NumberFormat("ms-MY", {currency:"MYR"})`, relative dates for due ("Thu"), absolute for deadlines ("apply by 15 Dec").
- `?demo=1` on invoice detail pre-fills the WhatsApp message; nobody types on stage.
- Commit hourly. Keep README current: problem, demo link, real vs simulated, feature mapping, metrics, how to run, limitations.
