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

**Framing (one line each, said once, never as a rubric walkthrough):** *not fraud detection* (fraud is a stranger stealing once; this is your best customer slowly killing you) → *the data rail is MyInvois, which only exists since July* (we proved the method on public data; MyInvois is why it runs on real invoices from now on). The "supply-chain anomaly for the money" line is **Q&A only**, if a judge asks where it fits the suggested domains. Don't put Detect/Categorize/Prioritize/Explain on a slide as headings; let the demo show them and put the four words as a small footer on the proof slide.

**User:** owner of a Malaysian small business that invoices other businesses. Demo persona: Ah Seng, printing shop, Kajang, 3 staff, **RM65k/month (~RM780k/yr, inside MyInvois Phase 5: RM500k–1m, mandatory from 1 Jul 2026; <RM500k exempt)**, one corporate customer who always pays 30+ days late. Call him a "small business" on slides (SME Corp: micro is <RM300k turnover *or* <5 staff; he's micro by headcount, small by turnover; "small" is the safe word). Pitch person confirms the Phase 5 threshold on LHDN's own page before the slide, not a blog.

**Prediction point (this governs the whole model):** an invoice is scored at issue date and re-scored daily **until its due date**. After the due date, P(late) is 1 by definition and is never shown; overdue invoices are handled by a separate overdue path (see §5 Action).

**Rubric mapping (the judges' own words):**

| Judges require | KiraKira |
|---|---|
| Detect | P(late) + expected days late per invoice; 90-day cash projection with danger date |
| Categorize | Chronic late payer · Seasonal risk · Unusual for this customer · Large & new · Disputed · Normal |
| Prioritize | cash at risk = amount × P(late), ranked; days-until-it-hurts |
| Explain | SHAP top-3 → one sentence in BM/EN; cost maths behind each action |
| Decide better | action per invoice + money ladder with act-by dates |
| Prove it | time-split backtest on a **public benchmark** (IBM Watson AR dataset; simulated per its docs, say so) **plus a policy backtest**: model's weekly top-N chase list vs "largest first" / "oldest first" / random, share of eventually-late ringgit surfaced before due; optional train-on-IBM / test-on-Kaggle check; proof page inside the app |
| Minimize false alarms | explicit "No action" bucket; threshold tuned on validation; **daily chase cap of 5**; precision on the chase bucket reported |
| Robust on unfamiliar data | time split (later invoices) **and** hold-out-customers split (unseen customers); cold-start path for new customers; missing-value check |
| Measurable impact | "top 20% of list captures X% of late ringgit"; RM recovered N days earlier, assumptions stated |

---

## 2. Features

### MUST (done by Sat 23:00)
1. **Chase-today list** in **owner mode by default**: words, not numbers ("Likely late", "Watch", "Fine"), max 5 rows, each with a one-line reason and one action. Numbers (P(late), cash at risk, SHAP) live behind a "Details" toggle. The Monday screen must read like three WhatsApp messages, not a dashboard.
2. **Invoice detail**: reason sentence, action + cost comparison, best time to chase; SHAP bars under "Why (details)"
2b. **Draft & send (human-in-the-loop, closes the decide→act loop)**: Claude drafts the reminder in the customer's language and tone (Good → friendly nudge, Bad/chronic → firm with dates, promise → references it), owner edits, taps **Send on WhatsApp** → opens `https://wa.me/<number>?text=<urlencoded draft>` with the message pre-filled; owner hits send himself. Log the tap as a `chase_sent` event (feeds best-time-to-chase). **Never auto-send.** The system proposes, the owner decides. ~1 hour.
3. **Payer Rating** per customer (Good / Average / Bad)
4. **Promise-to-pay**: paste customer's WhatsApp reply (Manglish/BM) → `{date, amount, confidence}` → forecast updates. **Ranked above the ladder: this is the demo moment.**
5. **Cash projection** (90 days, buffer, danger date, shortfall)
6. **Proof page** (for the accountant and the judges, not the owner): model card, time-split + unseen-customer AUC, calibration, N=5 policy chart, ablation (history-only vs full), **real-invoice slice** (see §4.4), disclosure
7. **Money ladder, three rungs only**: chase (promise-to-pay) → one government micro-financing rung (TEKUN) → invoice financing. Each rung shows cost, **official processing time or "not published"**, source link, and "checked 10 Oct 2026" inline. Never show a speed number we made up.

**Build order inside MUST:** 1 → 6 → 2 → 3 → 5 → 4 → 7.
**Cut order if behind at 23:00:** SHOULD features → best-time-to-chase → ladder (drop entirely before touching anything else) → SHAP bars (keep the sentence) → promise-to-pay last. Never cut the proof page or the real-invoice slice.
**Inside the proof page, cut order:** noise test → Kaggle second-dataset row → N=3/10 bars (keep N=5) → cold-start row. Never cut: time-split AUC, customer-split AUC, calibration, the N=5 policy chart, the disclosure.

### SHOULD (only after 23:00 checkpoint passes)
8. **Real send via Twilio WhatsApp sandbox**: `POST /send {invoice_id, text}` → message lands on a teammate's phone on stage. Recipient must join the sandbox first (one-time code). Use live only if it worked 3/3 in the 03:00 run-through; otherwise the `wa.me` path with a phone on the table.
9. Buku 555 photo → transactions (Claude vision; pre-parsed fallback)
10. "Can I afford it?" one-line Q&A re-running the projection

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
POST /draft       { invoice_id } → { text, language, tone, wa_link }   (wa_link = wa.me URL with text encoded)
POST /chase-sent  { invoice_id, channel } → { ok }                    (logs the tap)
GET  /proof       → Proof
POST /send        { invoice_id, text } → { ok, sid }                   (SHOULD, Twilio sandbox)
POST /parse-buku  (image) → Transaction[]          (SHOULD)
POST /ask         { question } → { answer, projection }   (SHOULD)
```
Types are in `kayla-frontend-plan.md`. Frontend builds on `public/mock/*.json` in these exact shapes from hour 1; backend swaps in at 22:00.

---

## 4. Data

### 4.1 Training (public benchmark → proof slide)
**Primary: IBM "Late Payment Histories"** (2,466 invoices, 100 customers, Jan 2012–Dec 2013, all settled, 35.6% late, no missing values; columns `customerID, InvoiceDate, DueDate, InvoiceAmount, Disputed, SettledDate, PaperlessBill, countryCode`). Profiled in `docs/kirakira-dataset-shortlist.md`. **It is simulated data per IBM's own documentation.** Every slide, the proof page, the README and the Q&A say "public benchmark (IBM Watson simulated AR dataset)", never "real invoices". Known quirks to state, not hide: amounts barely vary ($5–128) and terms are all 30 days, so "largest first" will be a weak baseline; last-20% test slice has 494 rows / 140 late; no unseen customers in the time slice (that's what the customer split is for).

**Secondary (if a teammate downloads and sanity-checks it by 15:00): Kaggle "Payment Date Prediction for Invoices"** (50k rows, HighRadius-style schema: `cust_number, due_in_date, clear_date, total_open_amount, cust_payment_terms, isopen`; real-vs-synthetic unstated). 10-minute check: late rate, invoices per customer, rows in last 20%, `isopen` count, duplicates, licence. If healthy → **train-on-IBM, test-on-Kaggle** as the "unfamiliar data" row on the proof page. If not healthy by 15:00, drop it; IBM alone is enough.

**`Disputed`:** strongest non-history feature (AUC 0.66 alone) but may not be known at issue date. Headline numbers **without** it; one footnote row **with** it.

- Target: `late = settled > due`; secondary `days_late`
- **Censoring rule:** an invoice is labelled only if it was settled by the dataset cutoff **or** is ≥30 days past due at cutoff (then `late = 1`). Open invoices younger than that are **dropped**, not labelled on-time. The test slice is where this bites; check how many rows survive.
- Features known at prediction time only: amount, terms, amount ÷ customer median, issued month/weekday, and customer history built **only from prior invoices that were already settled before this invoice's issue date** (count, late share, mean days-to-pay, days since last payment, tenure). Prior invoices still *open* at issue date contribute **only** to `open_balance`, never to late share or days-to-pay (otherwise their future paid date leaks in). Rating window = 12 months of settled invoices as of issue date. `Disputed` excluded from the headline model (see 4.1).
- **Two splits, both reported:** (a) time-based, first 80% of dates train / last 20% test; (b) hold-out customers, `GroupKFold` by customer ID, to show it works on businesses it has never seen. Never random.
- **Cold start:** not testable on the time slice (every test customer has history). Test it by truncating history to the first 0–2 invoices per customer in the test slice and re-scoring; report that AUC. Falls back to amount/terms/month.
- **Noise check (optional, drop first if short on time):** AUC with 20% of feature values nulled.
- **One `features.py`** builds features from `(invoices, settlements)` for *both* the training data and the Ah Seng demo data. If a feature can't be built from the demo schema, it doesn't go in the model.

### 4.2 Demo (simulated → disclosed)
Ah Seng, 14 months, generated Saturday 13:30–15:00 by Backend:
- `ahseng_invoices.json` in **MyInvois UBL-ish shape**: supplier TIN, buyer TIN, buyer name, MSIC, invoice datetime, line items, total, payment terms
- `ahseng_settlements.csv`: invoice_id, paid_date, amount (this is the ledger; e-invoices have no paid-date field, say so)
- `ahseng_cash.csv`: daily balance, rent, salaries on 25th, supplier bills
- Planted: Syarikat ABC pays 30–45 days late every time · Delta Print, new, one invoice 3× normal · school-holiday + Raya revenue dip · three customers always on time
- Reminder log with send weekday/hour vs days-to-pay (for best-time-to-chase)
- **Schema must match `features.py` input exactly** (invoice_id, customer_id, issued, due, amount, terms, disputed; settlements: invoice_id, paid_date, amount). The real model scores Ah Seng's open invoices live. **Never quote accuracy on the demo book**; the patterns are planted, so any number is circular.

### 4.4 Real-invoice slice (kills the "simulated on simulated" objection; highest-leverage task left)
**Goal:** by Sun 03:00, the model has scored **≥20 real invoices from one real business**, shown on one slide and one proof-page row.
- **Source, in order of preference:** (1) a teammate's or family member's business that uses Bukku / SQL / AutoCount / UBS: export the debtor ledger (invoice no., customer, date, due, amount, paid date) as CSV; (2) a friend's freelance/agency invoices from Xero/Wave/spreadsheet; (3) the printing shop / warung next to campus, asked politely with a printed one-page consent note. Kayla's family real-estate business is a candidate; ask tonight.
- **Anonymise before it touches the repo:** replace customer names with `Cust-01…`, round amounts to nearest RM100, shift all dates by a constant offset. Keep the raw file off GitHub; only the anonymised CSV goes in `data/real_slice.csv`. Written consent in the owner's WhatsApp is enough.
- **Use:** run `features.py` → `score_csv.py` on it. Proof-page row: "Scored 23 real invoices from a Klang Valley business (anonymised, consented): N flagged, of which M were in fact paid late." Even if M is small, it's the only real number in the room. Slide line: "This is the first real book it has ever seen. It flagged the right customer."
- **If nobody can get real data by 20:00:** fall back to a *teammate's own* receivables (tuition, freelance) with ≥10 rows; still real. Only if that fails, say on stage: "We've asked three businesses; the first pilot starts Monday," and name them.

**Guaranteed online fallback (Backend, 30 min, do it regardless): real public per-invoice data.**
| Source | What it is | Use | Caveat |
|---|---|---|---|
| **UK council "payments to suppliers over £500"** CSVs (Durham, Sevenoaks, North Lincolnshire; index on data.gov.uk; Open Government Licence) | every invoice a council paid: supplier, amount, invoice date, payment date; thousands of rows/year | `due = invoice + 30` (UK public-sector statutory terms), `late = paid > due`; "customer" = the council; run train-on-IBM → test-here → **proof-page row "tested on N real UK public-sector invoices, AUC x"** | roles flipped (council is the payer); check the CSV has *both* dates before mapping; not an SME book, say so |
| **Kaggle 50k "Payment Date" dataset** | B2B invoices with `cust_number, due_in_date, clear_date, total_open_amount` | second test set if the 15:00 sanity check passes | provenance unstated; label "provenance unstated" on the page |
| Open Collective expenses API | created/approved/paid timestamps per collective | only if both above fail; late = paid > 14d after approval | expense claims, not invoices |
These give "tested on real invoices". They do **not** give "a real Malaysian business used it"; that's the WhatsApp ask above. Do both.

### 4.3 Malaysian calendar (rule layer, not a model feature)
`my_calendar_2026_27.csv`: Ramadan/Raya, CNY, Deepavali, school holidays, year-end, payday 25th. Used for the Seasonal tag and projection revenue adjustment.

### 4.5 Ladder rungs (`ladder_rungs.csv`): three rungs, every number traceable
| Rung | Cost (as published) | Processing time | Source + checked |
|---|---|---|---|
| Chase the flagged invoices first (promise-to-pay) | RM 0 | days to due | — |
| TEKUN Nasional micro-financing | ~4% p.a. profit rate, RM1k–100k (Budget 2025 figures) | **"not published; apply ≥6 weeks before you need it"** | bernama.com (Budget 2025); tekun.gov.my; checked 10 Oct 2026 |
| Invoice financing (Funding Societies / CapBay) | published fee range from their site, 80% advance, 30–120 days | 3–7 working days (their own claim) | fundingsocieties.com.my help centre; checked 10 Oct 2026 |
| 🚫 Ah long | never | — | — |

Rules: a number appears only if the source is linked on the card. If a processing time isn't published, the card says so and gives a conservative "apply by" instead. Pitch person re-checks the two external rows against the live pages before 07:00. Dropped from the ladder (mention verbally if asked): BSN Micro, SJPP, early-payment discount (that's already an invoice-level action), credit card.

---

## 5. Logic

### Model (ML person)
1. Load, target, time split, class balance
2. Logistic baseline → AUC
3. LightGBM classifier → AUC (time split **and** customer split), **top-20% late-ringgit capture**
4. **Tune the chase threshold on a validation slice** (last 20% of train): pick the threshold where precision on the chase bucket ≥ 0.7, or max F1 if that's unreachable. Report precision/recall at that threshold. The 0.7/0.5/0.3 numbers in the action table are placeholders until this runs.
5. Isotonic calibration → calibration curve (save PNG + bins JSON)
6. LightGBM regressor on days late → MAE
7. Save test-period predictions to `model/predictions_test.csv` (invoice_id, as_of_date, p_late, days_late_pred). **Hand off here.** The policy backtest is owned by **Backend** (or Pitch if Backend is behind) and runs off this file, not off the ML person's time.
8. SHAP top-3 per invoice → templated sentence (ML owns the template; Backend's Claude call only polishes/translates it)
9. `predict(df) → DataFrame`, save `model.pkl`; numbers to Pitch by 19:00, unrounded
10. `model/score_csv.py in.csv out.csv`: scores any CSV in the `features.py` input schema. 20 minutes. This is the answer if organisers produce a hidden dataset, the "unfamiliar data" demo if they don't, and the tool for the real-invoice slice (§4.4). **Pitch person asks the organisers at 13:00 whether a hidden test set exists and in what format.**
11. **Model card + ablation (30 min, gives the technical judge something to read):** on the proof page, a short card: inputs, target, censoring rule, two splits, threshold, calibration method, known failure modes (new customers, disputed invoices, benchmark amount variance). Plus a 3-row ablation: history features only / + amount & terms / + calendar tags → AUC each. Shows you know *which* features carry the signal (history ≈ 0.85 alone) instead of waving at "AI".

### Policy backtest (Backend/Pitch, from `predictions_test.csv`, ~1h)
Precise metric: **share of eventually-late ringgit whose invoice appeared in the chase list at least once before its due date.**
- Period: the test slice. Cadence: **weekly** (IBM test slice is ~2.7 invoices/day, so daily top-5 would be "everything"). Each Monday, rank *open, not-yet-due* invoices by (a) model `cash_at_risk` using the prediction as of that date, (b) largest amount, (c) earliest due date, (d) random (average over 50 seeds). Take the top N.
- Report at **N = 3, 5, 10** as grouped bars. Only use predictions made before due date; overdue invoices never enter the list.
- Caption on the proof page, verbatim: "This measures how much late money the list would have *surfaced in time*, not how much it would have *recovered*; the benchmark can't tell us how much chasing speeds payment. Amounts in this benchmark vary little, so 'largest first' is a weak baseline here; on real books it isn't."

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

### Action
Two paths. **Overdue path** never uses `p` (it's 1 by definition); it uses days overdue and amount. **Pre-due path** uses the model. Thresholds `T_hi`, `T_lo` come from step 4 of the model plan (placeholders 0.6 / 0.3). First matching row wins; every case is covered.

**Overdue path (due date passed, unpaid):** `overdue_days = today − due`, `expected_pay = due + days_late_pred` (or promise date). Rank among overdue by `amount × overdue_days`. Card shows "X days overdue · model expects payment ~DATE", not a probability.

| # | Condition | Action | Shown reason |
|---|---|---|---|
| O1 | overdue ≥ 30d | **Escalate** | formal notice / pause supply; "RM X, 34 days overdue" |
| O2 | overdue 8–29d | **Chase now** (call) | best time to send; customer rating shown |
| O3 | overdue 1–7d | **Chase now** (reminder) | polite reminder; many pay in week one |

**Pre-due path (not yet due):**

| # | Condition | Action | Shown reason |
|---|---|---|---|
| P1 | p ≥ T_hi and due ≤ 14d | **Chase now** | "High risk, due soon" + best time to send |
| P2 | p ≥ T_hi and due > 14d and amount ≥ book.p75 | **Offer 2% early discount** | "discount RM X < expected delay cost RM Y" (show both) |
| P3 | p ≥ T_hi and due > 14d (smaller amount) | **Schedule chase** for due − 7d | not worth a discount |
| P4 | T_lo ≤ p < T_hi | **Watch** (reminder on due date, no call) | medium risk |
| P5 | p < T_lo | **No action** | "Good customer, don't annoy them" |

Chase list ordering: `pushes_red` first, then overdue path by `amount × overdue_days`, then pre-due by `cash_at_risk`. Cap 5 actionable rows.

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

### Draft & send (Backend, Claude)
```
POST /draft {invoice_id}
Inputs to the prompt: customer name, rating, invoice amount/due, reason sentence, promise (if any),
                      language of the customer's last message (default BM+EN), owner's business name
Tone rule: Good → friendly, one line, no dates pressure
           Average → polite with the due date
           Bad / chronic → firm, cites last late payments and the due date, offers a payment plan
           promise exists → "as you mentioned, RM X on DATE; just confirming"
Output: {text (≤ 60 words, no emojis unless customer uses them), language, tone}
wa_link = "https://wa.me/" + customer.phone + "?text=" + urlencode(text)
```
Never send without the owner's tap. The drafted text is editable in the UI. Cache per invoice; regenerate on "Rewrite".

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
| **ML** | IBM dataset, features.py, train.py, two splits, threshold tuning, calibration, cold-start check, SHAP template, `predictions_test.csv`, rules.py (rating/category/action/best-time), score_csv.py, export_predictions.py | predictions + numbers 19:00 · rules 22:00 · export 05:00 |
| **Backend** | FastAPI, synthetic Ah Seng data (MyInvois shape), calendar, projection.py, ladder.py, llm.py (promise, buku, phrasing), **policy backtest from `predictions_test.csv`**, Render deploy, README "how to run" | mock-shaped API 20:00 · policy chart JSON 21:00 · real model wired 22:00 |
| **Pitch (extra, 13:00)** | ask organisers: hidden test set? format? · teammate with Kaggle login downloads the 50k dataset and runs the 10-min sanity check by 15:00 · **starts the real-invoice hunt (§4.4) at 13:00: message three business owners, consent note ready by 14:00, CSV in hand by 20:00** | real slice scored 03:00 |
| **Scope enforcer = Pitch person** | At 19:00 and 23:00 reads the checkpoint aloud and applies the cut order. Nobody argues at 23:00; the order was agreed at 13:00. **Rule: the pitch describes only what was shown working in the 03:00 run-through.** Anything not shown is "next step", not "we built". | |
| **Frontend (Kayla)** | Next.js on Vercel from 13:30, all screens on mock, swap to API, mobile pass, demo video recording | screens 22:00 · real API 23:00 · video 05:00 |
| **Pitch / research** | dataset licence, stats slide (Experian 64 days; Coface 40%; DOSM 39.7%), competitor answers, slides PDF, README narrative, Q&A drill, presents | slides v1 23:00 · final 07:30 |

Everyone at 13:00: agree the contract; deploy hello-world to Vercel + Render; open both on a phone on mobile data.

---

## 7. Timeline

| Time | Goal | Checkpoint |
|---|---|---|
| **13:00–13:30** | Contract locked, repo, Vercel + Render hello-world | both URLs open on a phone |
| **13:30–19:00** | ML: model + backtest · Backend: Ah Seng data + projection + ladder · Frontend: Home + Invoice detail on mock · Pitch: stats, competitors, slide skeleton | **19:00** backtest numbers exist; Home renders from mock |
| **19:00–23:00** | ML: rating/category/action/best-time + SHAP sentences + model card/ablation · Backend: wire model, promise endpoint, Claude phrasing, policy backtest · Frontend: Cashflow + Proof, owner-mode toggle, then swap to API · Pitch: slides v1, **real CSV received and anonymised** | **23:00** end-to-end on the deployed link **and** `score_csv.py` runs on the real slice. If not → Pitch applies the cut order, no discussion |
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
| 0:55–2:05 | **Live demo** (deployed link, owner mode): Home: three sentences, "7 customers: fine, leave them" → ABC detail: Bad rating, reason, "Chase now, Tue 10am" → **Draft: firm BM/EN reminder citing the two late invoices → tap Send → WhatsApp opens pre-filled on the phone on the table** (judges see it; owner sends, not the machine) → **paste ABC's reply → promise 0.8, forecast moves** (the moment; pause 2s) → Cashflow: red zone, "Short by RM 8,000 on 14 Feb" → ladder: "Chase ABC this week; TEKUN, apply by 15 Dec" → **real-invoice slide: "First real book it saw, last night. It flagged the right customer."** ≤15s on the proof page: point at the policy chart, say the one number, move on. | |
| 2:05–2:30 | Proof: "Trained and tested on a public AR benchmark (IBM's simulated late-payment dataset), split by time **and** by unseen customers: AUC a / b. Calibrated. **And the policy chart: a weekly top-5 list surfaces X% of late ringgit before due date, vs Y% chasing biggest-first, Z% oldest-first.**" Then the honesty line: "Both the benchmark and the demo book are simulated, and we say so. The method is what's proven; the real data is what MyInvois unlocks." | |
| 2:30–2:50 | Why now + business: MyInvois covers every firm >RM500k since July; BNM says e-invoice records now count toward loans; nobody reads them from the supplier's side. Plug-in for UBS/Bukku; lender referral revenue; "CTOS for invoices." | "We proved the method on public data. MyInvois is why it can run on every Malaysian business's **real** invoices from now on, and why nobody could build this last year." |
| 2:50–3:00 | Next: **multi-tier contagion**: buyer→supplier graph from e-invoice TINs, so a micro-SME is warned when its customer's customer starts slipping (the Ant MYbank graph, shrunk to Malaysia); live MyInvois API; retrain per business | |

Phase 2 on video call: same deck, screen-share the deployed link, demo.mp4 as backup.

### Q&A (15-second answers)
| Q | A |
|---|---|
| Why not send the reminder automatically? | "Because it's his biggest customer and his relationship. The model proposes the message, the tone and the time; he taps send. Every tap is logged, so it learns which reminders work. Auto-send is one config flag away for the invoices he marks 'routine'; we chose not to default to it." |
| Would Ah Seng actually read SHAP bars? | "No. He reads the Monday screen: three sentences in his language and one button each. The numbers are behind 'Details' for his accountant, and the proof page is for you." |
| Where did the 6 weeks for TEKUN come from? | "It isn't published, so the card says 'not published' and we tell him to apply six weeks early. We don't show processing times we can't source." |
| Is the data real? | "Partly, since last night: it scored 23 real invoices from a Klang Valley business, anonymised with consent, and flagged the right customer. The training benchmark and the demo shop are simulated, and we say so. The model is trained on IBM's public AR benchmark, which IBM documents as simulated; the demo book is our own simulation with planted patterns. What's real is the method: time split, unseen-customer split, calibration, policy backtest. The real data exists, in every MyInvois account; that's the product." |
| Why not real Malaysian data? | "None is public. The closest, a UK SME invoice microdata set, sits behind a research-access process. Our first pilot is one real business's MyInvois + ledger export." |
| Why is 'largest first' so weak in your chart? | "Benchmark artefact: amounts barely vary in that dataset. We flag it on the page. On a real book that baseline gets stronger, and so does cash-at-risk ranking." |
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
| No real invoices obtainable | teammate's own receivables (≥10 rows); last resort: name the three businesses asked and the Monday pilot date |
| Demo shows 70%, pitch claims 100% | Pitch person's rule: only what ran at 03:00 is "built"; the rest is "next" |
| Judges tour the proof page and lose the owner story | demo spends ≤15s there; owner mode is the default view on every screen |
