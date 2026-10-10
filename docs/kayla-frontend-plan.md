# KiraKira — Kayla's Plan (Frontend + Deploy)

You own everything the judges see, and the deployed link. Backend/ML hand you JSON; you never touch Python.

## Stack

| | Choice | Notes |
|---|---|---|
| Framework | **Next.js 15, App Router, TypeScript** | `npx create-next-app@latest kirakira-web --ts --tailwind --app --src-dir` |
| UI | **Tailwind + shadcn/ui** | `npx shadcn@latest init` then add: `card badge table button dialog textarea tabs tooltip progress sheet` |
| Charts | **Recharts** | `AreaChart` for projection, `BarChart` (horizontal) for SHAP |
| Data | `fetch` in server components, `swr` for the promise-to-pay re-run | no state library |
| Fonts | Geist (default) or Inter | don't spend time here |
| Deploy | **Vercel**, env var `NEXT_PUBLIC_API_URL` | hello-world live by 13:30 |
| Fallback | `/public/mock/*.json` served by a Next route handler if the API is down | same shapes as the API |

## Repo layout

```
kirakira/
  web/            ← you
    src/app/
      page.tsx                 chase list (home)
      invoice/[id]/page.tsx    invoice detail
      cashflow/page.tsx        projection + ladder
      proof/page.tsx           backtest + disclosure
      api/mock/[name]/route.ts serves /public/mock/<name>.json
    src/lib/api.ts             getInvoices(), getProjection(), postPromise()
    src/lib/types.ts           the contract below
    public/mock/invoices.json, projection.json, customers.json, proof.json
  api/            ← backend (FastAPI)
  model/          ← ML
  data/
```

## The contract (agree at 13:00, then nobody changes it)

```ts
type Category = "Chronic late payer" | "Seasonal risk" | "Unusual for this customer" | "Large & new customer" | "Disputed" | "Normal";
type Action = "Escalate" | "Chase now" | "Offer 2% early discount" | "Schedule chase" | "Watch" | "No action";
type Rating = "Good" | "Average" | "Average (new)" | "Bad";

interface Invoice {
  id: string; customer: string; customer_id: string; amount: number;
  issued: string; due: string;                    // ISO dates
  p_late: number; days_late_pred: number; cash_at_risk: number;
  expected_pay_date: string;                     // due + days_late_pred, or promise date
  pushes_red: boolean;                           // expected_pay_date > projection.danger_date → pin to top
  categories: Category[];                        // 1–2 tags, primary first
  reason: string;                                // one sentence, BM/EN
  action: Action; action_why: string;            // "discount costs RM120, delay costs ~RM400"
  customer_note?: string;                        // "Next order: ask 50% deposit" when rating is Bad
  best_chase_time?: string;                      // "Tue 10:00"
  promise?: { date: string; amount: number; confidence: number };
  shap_top3: { feature: string; label: string; impact: number }[];  // impact signed
}
interface Customer { id: string; name: string; rating: Rating; late_share: number; avg_days_late: number; n_invoices: number; open_balance: number; }
interface Projection {
  days: { date: string; balance: number }[]; buffer: number;
  danger_date: string | null; shortfall: number;
  ladder: { option: string; cost_label: string; speed_days: number; act_by: string; covers: number; feasible: boolean; source?: string }[];
}
interface Proof {
  dataset: string; licence: string; n_train: number; n_test: number; n_dropped_censored: number;
  auc_time: number; auc_customer: number; auc_coldstart: number; auc_noisy: number;
  threshold: number; precision: number; recall: number; top20_capture: number; mae_days: number;
  calibration: { bin: number; predicted: number; actual: number }[];
  policy: { strategy: "Model" | "Largest first" | "Oldest first" | "Random"; late_ringgit_covered_pct: number }[];
  policy_assumption: string;   // "we measure coverage of late ringgit, not recovery…"
  disclosure: string;          // real vs simulated
  feature_mapping: string;     // how training and demo schemas line up
}
```

Endpoints: `GET /invoices` → `Invoice[]` · `GET /customers` → `Customer[]` · `GET /projection` → `Projection` · `POST /promise {invoice_id, message}` → `{invoice: Invoice, projection: Projection}` · `GET /proof` → `Proof`.

Write `public/mock/*.json` yourself in the first hour with Ah Seng's 10 invoices. Make ABC the chronic late payer, Delta Print the large & new one, three good customers with `action: "No action"`.

## Screens (build in this order)

### 1. Home: "Chase today" (by 16:00)
- Header: **RM 23,400 at risk this month · 3 actions**
- Table sorted by `cash_at_risk` desc, **but any `pushes_red` invoice is pinned to the top** with a small red "pushes you into the red on 14 Feb" line under the customer name.
- Columns: customer (+ rating badge), amount, due (relative: "Thu", "in 3 wks"), P(late) as a small progress bar with %, category chips (1–2), action button.
- **Show at most 5 actionable rows** (`action` not in Watch/No action). Everything else collapses under "N more · watch or no action" (click to expand). This is the false-alarm story; make it visible.
- `customer_note` renders as a muted line under the action on the detail page, not in the table.
- Category chip colours: Chronic = red, Seasonal = amber, Unusual = violet, Large & new = blue, Disputed = grey, Normal = none.

### 2. Invoice detail (by 18:00)
- Top: customer, amount, due, rating badge, big P(late).
- **Why**: the `reason` sentence in large text; under it a horizontal bar chart of `shap_top3` (positive = red bars pushing risk up, negative = green).
- **Do this**: `action` as a primary button, `action_why` beneath, `best_chase_time` as a small line.
- **Promise-to-pay**: textarea "Paste the customer's reply", button "Read it". Calls `POST /promise`, shows the extracted promise(s) with confidence, then a toast "Forecast updated" and a link to Cashflow. Pre-fill the textarea with the demo message via a `?demo=1` query so you never type on stage.

### 3. Cashflow (by 20:00)
- Recharts `AreaChart`: balance line, `ReferenceLine` at buffer, shaded red area where balance < buffer, `ReferenceDot` + label at `danger_date`: "Short by RM 8,000 on 14 Feb".
- Below: **Money ladder** as a list, cheapest first. Each: option, cost, speed, **act by (bold, relative: "in 34 days")**, covers RM. Infeasible ones greyed with "too slow". Last row fixed: "🚫 Ah long — never".
- Replays after a promise is posted (swr `mutate`).

### 4. Proof (build right after Home, before Invoice detail)
- **Policy chart first**, top of page: horizontal bars, 4 strategies, "% of late ringgit covered by a 5-a-day chase list". Model bar highlighted. `policy_assumption` as a caption under it. This is the answer to the core judging question; it goes above the fold.
- Stat tiles: AUC (later invoices), AUC (unseen customers), AUC (cold start), precision / recall at threshold, top-20% capture. MAE and `n_dropped_censored` in small text.
- Calibration chart (line, predicted vs actual, with the diagonal).
- Disclosure paragraph verbatim from `proof.disclosure`; `feature_mapping` under it in a collapsible. Dataset name, licence, split method, train/test counts.
- This page is what the research-engineer judge will click. Don't skip it, don't make it pretty before it's complete.

### 5. Customers (only if ahead, 30 min)
Table of `Customer[]` with rating badges. Judges asked "CTOS for your customers?" → this is the screen.

## Your timeline

| Time | Do |
|---|---|
| 13:00–13:30 | Agree the contract. `create-next-app`, shadcn init, push, **deploy to Vercel**, confirm the URL opens on your phone on mobile data. |
| 13:30–14:30 | `types.ts`, `api.ts` (reads `NEXT_PUBLIC_API_URL`, falls back to `/api/mock/*`), write the 4 mock JSON files. |
| 14:30–16:00 | Home screen on mock (incl. pinned `pushes_red` row and the 5-row cap). |
| 16:00–17:00 | **Proof page** on mock (policy chart, tiles, calibration, disclosure). |
| 17:00–19:00 | Invoice detail incl. SHAP bars, customer note, promise textarea (posting to mock returns a canned result). |
| 19:00–21:00 | Cashflow chart + ladder. |
| 21:00–22:00 | Mobile pass (judges open links on phones). Empty/loading states. |
| 22:00–23:00 | Swap to real API. Fix shape mismatches with backend **together**. |
| 23:00–01:00 | Sleep. |
| 01:00–03:00 | Polish: loading states, empty states, number formatting (`RM 8,500`), dark mode off (one theme only), favicon, `<title>`. |
| 03:00–05:00 | Full run-through 3×; record the demo video with the deployed link (QuickTime screen record). |
| 05:00–06:00 | Sleep. |
| 06:00 | Decide: live API or precomputed JSON. If precomputed, `NEXT_PUBLIC_API_URL` unset and redeploy. |
| 06:30–08:00 | README screenshots, final deploy, test from phone again. Freeze. |
| **08:30** | Submit. |

## Rules for yourself

- One theme, light. No dark mode toggle, no animations beyond Tailwind transitions. Finished beats fancy.
- Numbers: `Intl.NumberFormat("ms-MY", {style:"currency", currency:"MYR", maximumFractionDigits:0})`. Dates relative where it helps decide ("due Thu"), absolute where it's a deadline ("apply by 15 Dec").
- Every screen must render from mock with the API down. Test by stopping the backend once.
- `?demo=1` on invoice detail pre-fills the WhatsApp message. Never type on stage.
- Don't build: auth, settings, multi-business, dark mode, i18n toggle, onboarding. BM appears only inside the `reason` strings the backend sends.
- Commit every hour. Public repo by 08:00.

## Demo moments you own (rehearse these two until boring)

1. Invoice detail → paste reply → "Read it" → promise appears with 0.8 → toast → Cashflow re-renders with the dip moved.
2. Cashflow → the red zone and "Short by RM 8,000 on 14 Feb" → scroll to ladder → "TEKUN, apply by 15 Dec".
