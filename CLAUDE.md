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
- `data/` CSV/JSON in repo, no DB. **IBM "Late Payment Histories" public benchmark (simulated per IBM's docs; never call it "real")** for training; optional Kaggle 50k AR dataset as a second test set; simulated Ah Seng book in MyInvois-ish JSON + settlements CSV for demo; **`real_slice.csv`: ≥20 anonymised, consented real invoices from one business (raw file never in the repo)**; `my_calendar_2026_27.csv`; `ladder_rungs.csv` (3 rungs, every number sourced inline).
- Secrets only in Vercel/Render env vars. `grep -r sk-ant` before the repo goes public.

## Non-negotiable modelling rules
- **Prediction point:** score at issue date, re-score daily until due date. After due date P(late)=1 by definition and is never shown; overdue invoices take the overdue path (ranked by amount × days overdue).
- Time-based split AND hold-out-customers split (GroupKFold). Never random.
- Censoring: label only invoices settled by cutoff or ≥30 days past due at cutoff; drop the rest.
- Customer history features use **only prior invoices settled before this invoice's issue date**; open ones count only toward open balance. Rating window = 12 months as of issue date.
- `Disputed` excluded from the headline model; reported with/without as a footnote.
- Tune chase threshold on a validation slice (precision ≥ 0.7 on chase bucket). Action table thresholds are placeholders until then.
- Policy backtest (owned by Backend from `model/predictions_test.csv`): **weekly** top-N (N=3/5/10), pre-due predictions only, model vs largest-first vs oldest-first vs random (50 seeds); metric = share of eventually-late ringgit surfaced before due. Caption: coverage, not recovery; benchmark amounts vary little so largest-first is weak here.
- Proof page also carries: model card, 3-row ablation, cold-start AUC (history truncated), and the **real-invoice slice** result.
- Never quote accuracy on the demo book; its patterns are planted.
- Owner mode is the default UI: words ("Likely late / Watch / Fine"), one reason, one action. Numbers and SHAP behind "Details". The proof page is for accountants and judges.

## Scope
- MUST: chase list (owner mode) · invoice detail (reason + action; SHAP under Details) · **draft & send via `wa.me` link, owner taps send, never auto-send** · payer rating · **promise-to-pay** · cash projection · proof page (incl. real-invoice slice + real UK-council-invoice robustness row) · money ladder (3 rungs, sourced inline).
- Build order: chase list → **proof page** → invoice detail → rating → cashflow → promise-to-pay → ladder.
- SHOULD (only after 23:00 checkpoint): buku 555 photo → transactions; "can I afford it?" Q&A.
- CUT: GrantCheck, WhatsApp bot (one mockup image), multi-business, contagion graph (Q&A only), auth, dark mode, i18n toggle, rubric-walkthrough slide.
- Cut order if behind: SHOULD → best-time-to-chase → ladder (whole) → SHAP bars (keep sentence) → promise-to-pay. Never cut the proof page or the real-invoice slice.
- Pitch person is scope enforcer at 19:00 and 23:00. The pitch claims only what ran in the 03:00 run-through.

## Checkpoints
13:00 contract locked + both hello-worlds deployed and opened on a phone on mobile data · 19:00 backtest numbers exist, Home renders from mock · 23:00 end-to-end on the deployed link · 03:00–05:00 run-throughs + record demo video · 06:00 live-API vs precomputed decision · 08:00 freeze · **08:30 submit**.

## Docs
- `docs/kirakira-TEAM-FINAL.md` — full team plan: features, logic (rating/categorize/prioritize/action tables), data plan, roles, timeline, pitch script, Q&A, checklist, risks.
- `docs/kayla-frontend-plan.md` — frontend: TypeScript contract (`Invoice`, `Customer`, `Projection`, `Proof`), screens in build order, repo layout, timeline.
- `docs/kirakira-research-and-pivot.md` — judges and sponsor, Malaysian stats with URLs, MyInvois facts, local competitors, US/China inspiration, ladder rung figures, promise-to-pay spec, honesty lines.
- `docs/kirakira-review.md`, `docs/kirakira-review-v2.md` — external reviews; all fixes applied to the plan.
- `docs/kirakira-dataset-shortlist.md` — dataset profiling (IBM primary, Kaggle optional), leakage checks, known quirks.
- `docs/hackathon-brief.md` — organiser rubric, submission rules, pitch format, timeline, judges, sponsor, verbatim.

## Git attribution
- **Never add `Co-Authored-By` trailers or "Generated with Claude Code" footers** to commits or PRs in this repo. Commits are authored by the team member only. `.claude/settings.json` enforces this; this line is the backup.

## Working style for this repo
- Match the contract in `docs/kayla-frontend-plan.md` exactly; if a field must change, change the doc first.
- Every screen must render with the API down (mock fallback).
- Light theme only, one idea per screen, `Intl.NumberFormat("ms-MY", {currency:"MYR"})`, relative dates for due ("Thu"), absolute for deadlines ("apply by 15 Dec").
- `?demo=1` on invoice detail pre-fills the WhatsApp message; nobody types on stage.
- Commit hourly. Keep README current: problem, demo link, real vs simulated, feature mapping, metrics, how to run, limitations.
