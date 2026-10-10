# KiraKira — Team Final Plan & Tech Stack

**Dormathon 2026 · Track 1 · Taylor's**
**Build:** Sat 13:00 → Sun 08:30 submit (hard buffer 09:00, deadline 09:30)
**Submit:** public GitHub · deployed app link · slides PDF · team name + branch
**Pitch:** Phase 1: 3 min + 2 min Q&A in person · Phase 2 (top 18): 4 min + 3 min Q&A on video call

This supersedes `kirakira-final.md`. Research and sources are in `kirakira-research-and-pivot.md`; Kayla's screen-level plan is in `kayla-frontend-plan.md`.

---

## 1. The product in one paragraph

> **KiraKira: a credit score for your customers, built from your own invoices.**
> Every Malaysian business above RM500k now files every invoice to LHDN (MyInvois). We read that flow plus the ledger, predict which invoices will be paid late and by how much, rate each customer Good/Average/Bad, rank who to chase today by ringgit at risk, explain why in one sentence, read the customer's WhatsApp "bayar minggu depan" into a dated promise, and when cash still runs out, rank the cheapest money with an apply-by date. Never ah long.

**Framing (say this, in this order):** *not fraud detection* (fraud is a stranger stealing once; this is your best customer slowly killing you) → *supply-chain anomaly detection, for the money instead of the goods* (your customers are your supply chain of cash; we spot the link that's about to fail) → *the data rail is MyInvois, which only exists since July*, not Kaggle.

**User:** owner of a Malaysian micro-business that invoices other businesses. Demo persona: Ah Seng, printing shop, Kajang, **RM65k/month (~RM780k/yr, so he's inside MyInvois Phase 5)**, one corporate customer who always pays 30+ days late.

**Rubric mapping (the judges' own words):**

| Judges require | KiraKira |
|---|---|
| Detect | P(late) + expected days late per invoice; 90-day cash projection with danger date |
| Categorize | Chronic late payer · Seasonal risk · Unusual for this customer · Large & new · Disputed · Normal |
| Prioritize | cash at risk = amount × P(late), ranked; days-until-it-hurts |
| Explain | SHAP top-3 → one sentence in BM/EN; cost maths behind each action |
| Decide better | action per invoice + money ladder with act-by dates |
| Prove it | time-split backtest on real invoices **plus a policy backtest**: model's top-N chase list vs "largest first" / "oldest first" / random, late ringgit caught; proof page inside the app |
| Minimize false alarms | explicit "No action" bucket; threshold tuned on validation; **daily chase cap of 5**; precision on the chase bucket reported |
| Robust on unfamiliar data | time split (later invoices) **and** hold-out-customers split (unseen customers); cold-start path for new customers; missing-value check |
| Measurable impact | "top 20% of list captures X% of late ringgit"; RM recovered N days earlier, assumptions stated |

---

## 2. Features

### MUST (done by Sat 23:00)
1. **Chase-today list**: ranked invoices with P(late), cash at risk, category chip, reason sentence, action, customer rating badge
2. **Invoice detail**: reason, SHAP bars, action + cost comparison, best time to chase
3. **Payer Rating** per customer (Good / Average / Bad)
4. **Promise-to-pay**: paste customer's WhatsApp reply (Manglish/BM) → `{date, amount, confidence}` → forecast updates
5. **Cash projection** (90 days, buffer, danger date, shortfall)
6. **Money ladder** with sourced rungs and act-by dates
7. **Proof page**: dataset, split, AUC, precision/recall, top-20% capture, calibration chart, **policy backtest bar chart (model vs 3 baselines)**, hold-out-customer AUC, real-vs-synthetic disclosure

**Build order inside MUST:** 1 → 7 → 2 → 3 → 5 → 6 → 4. Proof page before the pretty parts.
**Cut order if behind at 23:00:** SHOULD features → best-time-to-chase → ladder down to 3 rungs → promise-to-pay. Never cut the proof page.

### SHOULD (only after 23:00 checkpoint passes)
8. Buku 555 photo → transactions (Claude vision; pre-parsed fallback)
9. "Can I afford it?" one-line Q&A re-running the projection

### CUT (do not build; mention as future)
GrantCheck / grant database · WhatsApp bot (one mockup image) · multi-business switcher · supply-chain contagion graph · auth, settings, dark mode

---

## 3. Tech stack

```
Browser ──► Next.js (Vercel) ──► FastAPI (Render) ──► LightGBM + SHAP (pickled)
                                      │
                                      ├──► Claude API: WhatsApp reply → JSON, buku photo → JSON, phrase reason
                                      └──► CSV/JSON data in repo (no DB)
```

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Next.js 15 App Router, TypeScript, Tailwind, shadcn/ui, Recharts** on **Vercel** | Kayla's stack; deploys in minutes; the deployed link is a submission requirement |
| API | **Python 3.11, FastAPI, uvicorn, pandas** on **Render** free tier (or Railway) | model + SHAP are Python; keep Python in Python |
| Model | **LightGBM** classifier (late y/n) + regressor (days late); **scikit-learn** logistic baseline + isotonic calibration; **SHAP** TreeExplainer | best tabular model, trains in seconds; calibration so 70% means 70% |
| LLM | **Claude API** `claude-sonnet-5-5` via `anthropic` SDK | reads text/images only; never in the prediction path |
| Data | `/data/*.csv` + `/data/*.json`, loaded at startup | nothing to provision at 2am |
| Dev | Kiro for scaffolding; Grafilab credits for Claude calls if needed | free |
| Repo | monorepo `kirakira/` with `web/ api/ model/ data/ slides/` | public by 08:00 Sun |

**Fallback:** `python model/export_predictions.py` writes `web/public/mock/*.json` from the real model. If Render misbehaves, unset `NEXT_PUBLIC_API_URL` and the site serves those. Identical demo. Decide at 06:00.

### Repo layout
```
kirakira/
  web/        Next.js (Kayla)
  api/        FastAPI: main.py, projection.py, ladder.py, llm.py, requirements.txt
  model/      explore.ipynb, features.py, train.py, rules.py, model.pkl, export_predictions.py
  data/       raw/<kaggle dataset>, ahseng_invoices.json (MyInvois shape), ahseng_settlements.csv,
              ahseng_cash.csv, my_calendar_2026_27.csv, ladder_rungs.csv
  slides/     deck.pdf, demo.mp4
  README.md   problem · demo link · what's real vs simulated · metrics · how to run · limitations
```

### API contract (locked at 13:00)
```
GET  /invoices    → Invoice[]
GET  /customers   → Customer[]
GET  /projection  → Projection
POST /promise     { invoice_id, message } → { invoice, projection }
GET  /proof       → Proof
POST /parse-buku  (image) → Transaction[]          (SHOULD)
POST /ask         { question } → { answer, projection }   (SHOULD)
```
Types are in `kayla-frontend-plan.md`. Frontend builds on `public/mock/*.json` in these exact shapes from hour 1; backend swaps in at 22:00.

---

## 4. Data

### 4.1 Training (real → proof slide)
Kaggle accounts-receivable / invoice-payment dataset with invoice date, due date, amount, customer ID, **actual settle date**. Candidates: "Late Payment Histories" (IBM sample, ~2.5k rows, has DaysLate/Disputed) or a larger "Payment Date Prediction" AR dataset (~50k rows). Check licence. Prefer larger if clean; a clean backtest on 2.5k beats a vague claim on 50k.

- Target: `late = settled > due`; secondary `days_late`
- **Censoring rule:** an invoice is labelled only if it was settled by the dataset cutoff **or** is ≥30 days past due at cutoff (then `late = 1`). Open invoices younger than that are **dropped**, not labelled on-time. The test slice is where this bites; check how many rows survive.
- Features known at prediction time only: amount, terms, amount ÷ customer median, customer history **strictly before this invoice's issue date** (count, late share, mean days-to-pay, days since last payment, tenure, open balance), issued month/weekday, disputed flag. Rating window = 12 months **as of issue date**.
- **Two splits, both reported:** (a) time-based, first 80% of dates train / last 20% test; (b) hold-out customers, `GroupKFold` by customer ID, to show it works on businesses it has never seen. Never random.
- **Robustness checks (10 min each):** AUC with 20% of feature values nulled; AUC on customers with <3 prior invoices (cold start, where the model must fall back to amount/terms/month).
- **One `features.py`** builds features from `(invoices, settlements)` for *both* the training data and the Ah Seng demo data. If a feature can't be built from the demo schema, it doesn't go in the model.

### 4.2 Demo (simulated → disclosed)
Ah Seng, 14 months, generated Saturday 13:30–15:00 by Backend:
- `ahseng_invoices.json` in **MyInvois UBL-ish shape**: supplier TIN, buyer TIN, buyer name, MSIC, invoice datetime, line items, total, payment terms
- `ahseng_settlements.csv`: invoice_id, paid_date, amount (this is the ledger; e-invoices have no paid-date field, say so)
- `ahseng_cash.csv`: daily balance, rent, salaries on 25th, supplier bills
- Planted: Syarikat ABC pays 30–45 days late every time · Delta Print, new, one invoice 3× normal · school-holiday + Raya revenue dip · three customers always on time
- Reminder log with send weekday/hour vs days-to-pay (for best-time-to-chase)
- **Schema must match `features.py` input exactly** (invoice_id, customer_id, issued, due, amount, terms, disputed; settlements: invoice_id, paid_date, amount). The real model scores Ah Seng's open invoices live. **Never quote accuracy on the demo book**; the patterns are planted, so any number is circular.

### 4.3 Malaysian calendar (rule layer, not a model feature)
`my_calendar_2026_27.csv`: Ramadan/Raya, CNY, Deepavali, school holidays, year-end, payday 25th. Used for the Seasonal tag and projection revenue adjustment.

### 4.4 Ladder rungs (`ladder_rungs.csv`, sourced, labelled estimates)
| Rung | Cost | Speed |
|---|---|---|
| Chase top-N (promise-to-pay) | 0 | days to due |
| Early-payment discount | 1–2% | immediate |
| TEKUN Nasional | ~4% p.a. | ~6 wks (est.) |
| BSN Micro | from 6.38% p.a. | ~4 wks (est.) |
| SJPP-guaranteed working capital | bank rate + 0.5–1% fee | 4–8 wks (est.) |
| P2P invoice financing (Funding Societies / CapBay) | ~1–1.5%/month, 80% advance | 3–7 days |
| Credit card | ~18% p.a. | 0 |
| Ah long | never | — |

---

## 5. Logic

### Model (ML person)
1. Load, target, time split, class balance
2. Logistic baseline → AUC
3. LightGBM classifier → AUC (time split **and** customer split), **top-20% late-ringgit capture**
4. **Tune the chase threshold on a validation slice** (last 20% of train): pick the threshold where precision on the chase bucket ≥ 0.7, or max F1 if that's unreachable. Report precision/recall at that threshold. The 0.7/0.5/0.3 numbers in the action table are placeholders until this runs.
5. Isotonic calibration → calibration curve (save PNG + bins JSON)
6. LightGBM regressor on days late → MAE
7. **Policy backtest** (answers the core judging question): on the test period, each day pick the top-5 open invoices by (a) model cash-at-risk, (b) largest amount, (c) oldest due, (d) random. Count late ringgit that ends up on the chase list within 7 days of due. Report as a bar chart. **State the assumption explicitly on the proof page:** "we assume chasing an invoice before due date moves payment forward by X days; the data can't measure that, so the chart shows *coverage of late ringgit*, not recovery."
8. SHAP top-3 per invoice → templated sentence (ML owns the template; Backend's Claude call only polishes/translates it)
9. `predict(df) → DataFrame`, save `model.pkl`; numbers to Pitch by 19:00, unrounded

### Payer Rating
```
late_share = late invoices / all (last 12 months), min 3 invoices else "Average (new)"
Bad     if late_share ≥ 0.5 or avg_days_late ≥ 21
Good    if late_share ≤ 0.15 and avg_days_late ≤ 5
Average otherwise
```

### Categorize (primary + optional secondary, max 2 tags; evaluate all, keep the first two that fire)
```
disputed                                  → Disputed
rating == Bad and n ≥ 3                   → Chronic late payer
amount > 1.8 × customer.median_amount     → Unusual for this customer
customer.n < 2 and amount > book.p75      → Large & new customer
due_date in calendar risk window          → Seasonal risk
none fired                                → Normal
```
Card shows "Chronic late payer · Seasonal risk" when two apply. The reason sentence covers both.

### Prioritize
`cash_at_risk = amount × p_late`, sort desc; tie-break days-to-due asc.
**"Pushes you into the red" flag:** `expected_pay_date = due + days_late_pred (or promise date)`. If the projection has a `danger_date` and `expected_pay_date > danger_date`, flag the invoice and pin it to the top of the list regardless of rank. That's the days-until-it-hurts link between the list and the cash chart.
**Daily cap:** the chase list shows at most **5** actionable invoices; the rest collapse under "N more, lower risk". Caps false-alarm flooding.

### Action (ordered; first row that matches wins; every (p, due) combination is covered)
Thresholds `T_hi`, `T_lo` come from step 4 of the model plan (placeholders 0.6 / 0.3).

| # | Condition | Action | Shown reason |
|---|---|---|---|
| 1 | overdue ≥ 30d and p ≥ T_hi | **Escalate** | formal notice / pause supply |
| 2 | p ≥ T_hi and due ≤ 14d (incl. already overdue <30d) | **Chase now** | "High risk, due soon" + best time to send |
| 3 | p ≥ T_hi and due > 14d and amount ≥ book.p75 | **Offer 2% early discount** | "discount RM X < expected delay cost RM Y" (show both) |
| 4 | p ≥ T_hi and due > 14d (smaller amount) | **Schedule chase** for due − 7d | not worth a discount |
| 5 | T_lo ≤ p < T_hi | **Watch** (reminder on due date, no call) | medium risk |
| 6 | p < T_lo | **No action** | "Good customer, don't annoy them" |

Separate from the per-invoice action, a **customer-level note** appears on the card when `rating == Bad`: "Next order: ask 50% deposit or 14-day terms." It never overrides rows 1–6; it sits beside them. (This resolves the old chronic-vs-no-action conflict.)

### Best time to chase
Group reminder log by (weekday, hour bucket) → median days-to-pay → pick min. Output "Tue 10:00". Say it's learned from the demo history.

### Promise-to-pay (Backend, Claude)
```
POST /promise {invoice_id, message}
Claude: extract promises as JSON [{amount, date, confidence}], resolve relative dates vs today,
        handle Manglish/BM ("hujung bulan", "lepas gaji", "lepas Raya", "minggu depan", "half dulu")
If confidence ≥ 0.6 → invoice.promise set, projection uses promise date instead of model date
Log both. Card shows: "Model: 12 Nov · Promised: 3 Nov (0.8)"
```

### Projection + ladder (Backend)
```
balance[t] = opening + Σ expected inflows − known outflows
expected inflow per invoice: amount×(1−p) on due date, amount×p on due + days_late_pred
                             (or on promise date if set)
revenue adjustment from calendar table
danger_date = first t with balance < buffer; shortfall = buffer − min(balance)
for rung in ladder: act_by = danger_date − speed_days − 5; feasible = act_by ≥ today
rank feasible by cost, stack until shortfall covered; always append "Ah long — never"
```

---

## 6. Team roles

| Role | Owns | Hand-offs |
|---|---|---|
| **ML** | dataset, features, train.py, backtest numbers, calibration, SHAP, rules.py (rating/category/action/best-time), export_predictions.py | numbers 19:00 · rules 22:00 · export 05:00 |
| **Backend** | FastAPI, synthetic Ah Seng data (MyInvois shape), calendar, projection.py, ladder.py, llm.py (promise, buku, phrasing), Render deploy, README "how to run" | mock-shaped API 20:00 · real model wired 22:00 |
| **Frontend (Kayla)** | Next.js on Vercel from 13:30, all screens on mock, swap to API, mobile pass, demo video recording | screens 22:00 · real API 23:00 · video 05:00 |
| **Pitch / research** | dataset licence, stats slide (Experian 64 days; Coface 40%; DOSM 39.7%), competitor answers, slides PDF, README narrative, Q&A drill, presents | slides v1 23:00 · final 07:30 |

Everyone at 13:00: agree the contract; deploy hello-world to Vercel + Render; open both on a phone on mobile data.

---

## 7. Timeline

| Time | Goal | Checkpoint |
|---|---|---|
| **13:00–13:30** | Contract locked, repo, Vercel + Render hello-world | both URLs open on a phone |
| **13:30–19:00** | ML: model + backtest · Backend: Ah Seng data + projection + ladder · Frontend: Home + Invoice detail on mock · Pitch: stats, competitors, slide skeleton | **19:00** backtest numbers exist; Home renders from mock |
| **19:00–23:00** | ML: rating/category/action/best-time + SHAP sentences · Backend: wire model, promise endpoint, Claude phrasing · Frontend: Cashflow + Proof, then swap to API · Pitch: slides v1 | **23:00** end-to-end on the deployed link. If not → cut SHOULD now, fix MUST |
| **23:00–03:00** | sleep in shifts (2 awake). Awake pair: buku 555 + Q&A (SHOULD) or bug fixes | |
| **03:00–05:00** | 3 full run-throughs on deployed link · record demo.mp4 · export_predictions.py | |
| **05:00–06:00** | sleep | |
| **06:00** | decide live API vs precomputed JSON | |
| **06:00–08:00** | slides → PDF · README · repo public · final deploy · phone test on mobile data | |
| **08:30** | **Submit. Freeze.** | |
| **08:30–10:00** | pitch rehearsal 3× timed · Q&A drill | |

---

## 8. Pitch (3:00) and demo

| Time | Slide | Say |
|---|---|---|
| 0:00–0:20 | Hook: photo of a buku 555 | "Ah Seng's shop is profitable. In February he can't pay salaries. He'll find out two weeks before, when the only option left is an ah long." |
| 0:20–0:40 | Problem: "SMEs wait **64 days** to get paid (Experian 2025). **40%** of APAC firms had 180-day+ delays; 80% never recovered (Coface 2025). Malaysia has no general prompt-payment law; only construction does (CIPAA)." **Pitch person re-verifies every number against the source URL in `kirakira-research-and-pivot.md` before it goes on a slide.** | |
| 0:40–0:55 | What it is: Detect → Categorize → Prioritize → Explain → Decide, on one slide | "This is not fraud detection. It's supply-chain anomaly detection for the money: your customers are your supply chain of cash, and we flag the link that's about to fail before it does." |
| 0:55–2:05 | **Live demo** (deployed link): Home list → ABC detail: Bad rating, reason, SHAP, "Chase now, Tue 10am" → good customer: "No action" → paste WhatsApp reply → promise 0.8, forecast moves → Cashflow: red zone, "Short by RM 8,000 on 14 Feb" → ladder: "Chase ABC this week. TEKUN, apply by 15 Dec." | |
| 2:05–2:30 | Proof: dataset, time-split **and** unseen-customer AUC, precision/recall at the tuned threshold, calibration, **and the policy chart: "chasing our top-5 each day covers X% of late ringgit vs Y% if you chase the biggest invoices, Z% oldest-first."** "Demo book is simulated; the model isn't." | |
| 2:30–2:50 | Why now + business: MyInvois covers every firm >RM500k since July; BNM says e-invoice records now count toward loans; nobody reads them from the supplier's side. Plug-in for UBS/Bukku; lender referral revenue; "CTOS for invoices." | "Every other team's data is from Kaggle. Ours is a national data rail that didn't exist last year." |
| 2:50–3:00 | Next: **multi-tier contagion**: buyer→supplier graph from e-invoice TINs, so a micro-SME is warned when its customer's customer starts slipping (the Ant MYbank graph, shrunk to Malaysia); live MyInvois API; retrain per business | |

Phase 2 on video call: same deck, screen-share the deployed link, demo.mp4 as backup.

### Q&A (15-second answers)
| Q | A |
|---|---|
| Is the data real? | Model: real public invoices, time-split. Demo: simulated, disclosed on the slide and in the app. |
| E-invoices don't have paid dates. | Correct. The ledger supplies them; MyInvois gives buyer identity and timing at national scale. We need both. |
| Why not UBS/Bukku/Xero? | They report overdue. Nobody local predicts per invoice or rates the buyer from the supplier's side. |
| Isn't this just another finance/fraud model? | No. Fraud models score a transaction once. We score a *relationship* over time, the way supply-chain anomaly detection scores a supplier link. Same maths family, different problem, and the Malaysian version doesn't exist. |
| Where's the supply chain? | Your customers are your inbound supply chain of cash. A chronic late payer is a failing link. Next step is the graph: their late customer becomes your early warning. |
| Why not ChatGPT? | Can't score 200 invoices against history consistently or give a calibrated probability. It reads the WhatsApp reply; the model does the predicting. |
| False alarms? | Low-risk invoices get **no action**. Precision on the chase bucket is X. |
| Accuracy? | AUC X on later invoices, Y on customers it never saw, calibration shown. It's early warning: direction and timing, not a verdict. |
| Does it actually make a better decision? | Policy backtest: our top-5 list covers X% of late ringgit vs Y% chasing biggest-first. Assumption stated on the page: we measure coverage, not recovery, because the data can't tell us how much chasing speeds payment. |
| What about invoices still open at the end of your data? | Dropped unless ≥30 days past due. We don't label unknowns as on-time. |
| New customer with no history? | Cold-start path: model falls back to amount, terms, month; rating shows "Average (new)"; AUC on <3-invoice customers is on the proof page. |
| Ladder rates? | Public figures this week, labelled estimates with sources. Owner verifies. |
| Business model? | Free for owners; lenders pay per qualified lead; accounting-marketplace plug-in. |
| Legal/financial advice? | Decision support with the numbers shown. Owner decides. |

---

## 9. Submission checklist
- [ ] `ANTHROPIC_API_KEY` only in Render/Vercel env vars; `.env` in `.gitignore`; grep the repo for `sk-ant` before going public
- [ ] Kaggle dataset licence checked and named in README
- [ ] Three canned WhatsApp messages tested against `/promise` and pre-filled via `?demo=1`
- [ ] Repo public; README: problem, demo link, real vs simulated, **feature mapping between training and demo data**, metrics (both splits + policy chart), how to run, limitations
- [ ] Deployed link opens on mobile data
- [ ] Slides exported to PDF, uploaded
- [ ] demo.mp4 in repo and linked in slides
- [ ] Team name + Taylor's branch
- [ ] Submitted by **08:30**

## 10. Risks
| Risk | Backup |
|---|---|
| No good dataset | small IBM one, honestly; augment demo only |
| Mediocre AUC | report it; lead with top-20% capture |
| Render down / cold start | precomputed JSON (06:00 decision) |
| Claude misreads Manglish | 3 canned demo messages tested in advance; `?demo=1` pre-fills |
| Over scope | MUST is the product; SHOULD only after 23:00 passes |
| Out of time | submit 08:30 regardless; deployed MUST beats unsubmitted SHOULD |
