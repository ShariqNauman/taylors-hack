# KiraKira — Research Synthesis & Pivot (10 Oct 2026)

Companion to `kirakira-final.md` (the build plan). This file: who the judges are, what the Malaysian gap is, what to borrow from US/China, and exactly what changes.

---

## 0. What changes in the build (read this first)

| Area | Change | Effort |
|---|---|---|
| Positioning | "Late-payment prediction" → **payer intelligence on the MyInvois rail: a score for each of your customers, from your own invoice flow** | slides only |
| Demo data | Shape synthetic invoices as **MyInvois UBL JSON** (supplier/buyer TIN, MSIC, invoice date+time, line items) + a separate `settlements` table (paid date). Say explicitly: e-invoices have no paid-date field, the ledger supplies it. | 1h (backend) |
| New feature 1 | **Payer Rating** per customer: Good / Average / Bad, from late share, mean days late, trend. Shown as a badge in the list. | 1h (ML) |
| New feature 2 | **Promise-to-pay extraction**: paste the customer's WhatsApp reply (Manglish/BM) → Claude returns `{promise_date, amount, confidence}` → overrides the model's expected date, projection re-runs. | 2h (backend + 1 screen) |
| New feature 3 | **Best time to chase**: from history, which weekday/hour reminders got paid fastest. One line in the action card: "Send Tuesday 10am." Learned from synthetic history, say so. | 1h (ML) |
| Money ladder | Real rungs with sourced figures (section 5). Four rows. | research done |
| Cut | Nothing further. Do **not** add contagion graph, grants, WhatsApp bot. | |
| Closing slide | Supply-chain contagion + bureau product + BNM "why now" | slides only |

Priority if time is short: Payer Rating > promise-to-pay > best time to chase.

---

## 1. The panel (Taylor's branch) and what each one scores

| Judge | Who | What they'll probe | Your one line |
|---|---|---|---|
| **Shannon Choo** | AI Hackerdorm president; AI Tinkerers KL lead (demo-first, "no-pitch" culture); ex-YTL AI Labs; "Openclose Accounting" has no public footprint, treat as stealth AI accounting | Does it actually run? Is the problem real for an accountant? | "The predictive layer on top of UBS/Bukku e-invoicing. Every tool reports overdue; this predicts it." |
| **Khalil Nooh** | CEO Mesolitica (Malay-first LLMs, MaLLaM; B2B voice agents; bootstrapped). Says: domain knowledge beats coding; AI should run 100% in Malaysia; enterprises lack data-ready systems | Local language, sovereignty, do you understand the user | "Reads a customer's Manglish WhatsApp reply and turns it into a promise-to-pay date. Runs on Malaysian data, deployable in-country." |
| **Jack Min Ong** | Founding research engineer, Prime Intellect (decentralised RL, TOPLOC verifiable inference); "make throughput visible, benchmark trade-offs" | Is the backtest honest? Leakage? Calibration? | "Time-split, clip-level… sorry, invoice-level split by date. AUC X, calibration curve on the proof page, including the numbers that aren't great." |
| **Ashvin Praveen** | CEO Cleve.ai (40k users, Antler); product designer; NAIC director; "recognisability matters more than cleverness", mobile-first, build-in-public | Does it look like something people would use tomorrow? | "It's an inbox, not a chart: here's who to chase today, why, and what to send." |
| **Jing Yuan Phen** | 55 placements / 35 hackathons; openly shapes projects to the rubric | Fit to brief, strategic framing | Put **Detect · Categorize · Prioritize · Explain** on screen in the rubric's words. |
| **Muthuraman Palaniappan** | Taylor's student, MIT Hacking Medicine winner (early-detection prototype); "competitions test whether an idea survives contact with reality" | Early detection credibility, real user | "Early warning, not a verdict: direction and timing." |
| **Hong Bing Sim** | AI Hackerdorm co-founder; Tack (real-time meeting moderator), CodeKite (API monitoring) | Will the live demo hold up; reliability | Deployed link, precomputed fallback, backup video. |
| **Andrew Gostishchev** | Senior SWE / independent AI researcher; publishes honest negative results | Reproducibility, limitations | README with how to run + metrics, limitations section. |
| **Ace Yip** | Very young serial builder (edtech, live-commerce AI); "Orbital" title unverified | Product/GTM energy | Distribution via accounting marketplaces. |

**Title sponsor, The Access Group:** owns **Access UBS** (bought Sage Asia 2021), 100k+ Malaysian SMEs, 30k active on e-invoicing, free LHDN submission since 2024. Ships dashboards, "Copilot", "Actionable Insights", **no concrete predictive feature**. Their blog frames SME pain as: small firms lack data for analytics, fear data exposure, staff resist AI. "Private AI" pitch: data stays in Malaysia, ISO 42001. KL hub targets 1,000 staff by 2027; the hackathon is partly a hiring pipeline.
→ Frame KiraKira as a UBS/Bukku plug-in, privacy-first, humans decide. That's their roadmap gap in their own words.

**Organiser culture (AI Hackerdorm / AI Tinkerers):** "screened, demo-first, no-pitch"; judging proxies: problem clarity, solution/tech quality, impact & scalability. Slides-only loses.

---

## 2. Malaysia: the numbers and the gap

### Stats for the slide (pick three)
1. **SMEs wait 64 days on average to get paid**; SMEs pay 26 days later than corporates in transport/logistics; construction peaked at 87 days. — Experian Malaysia, *State of Credit 2025*, 21 May 2025. https://www.experian.com.my/2025/05/21/experian-malaysias-state-of-credit-2025-reveals-sme-resilience-but-cash-flow-strains-persist/
2. **40% of APAC companies reported ultra-long payment delays (>180 days) in 2024, double 2023; Malaysia among the four worst; 80% of such debt is never recovered.** — Coface *Asia Payment Survey 2025*, 11 Jun 2025. https://www.malaysiasme.com.my/coface-asia-payment-survey-2025-ultra-long-payment-delays-hit-record-high-as-businesses-brace-for-tougher-times/
3. **MSMEs = 39.7% of GDP (RM689.8bn), 48.7% of jobs (8.09m)**; **two-thirds hold <6 months of cash**; 85% expect to need external finance. — DOSM, 30 Jul 2026 https://www.dosm.gov.my/portal-main/release-content/micro-small--medium-enterprises-msmes-performance-2025 ; SME Association of Malaysia via Malay Mail, 6 Sep 2024 https://www.malaymail.com/news/money/2024/09/06/smes-face-shrinking-margins-despite-economic-recovery-group-warns/149520 ; CPA Australia 2024-25 survey.

Backup: 1.505bn e-invoices from 230k+ taxpayers by Jun 2026 (Bernama). SME Corp 2018: of SMEs with cash-flow problems, 43% blamed late customer payment.
**Do not use** "82% of businesses fail from cash flow": it's a US figure.

### Why there's no backstop
- **No prompt-payment law** in Malaysia outside construction (CIPAA 2012). UK is legislating a 60-day cap; India has a 45-day MSME rule. Malaysia has nothing.
- Government pays in 14 days by Treasury Instruction AP103(a) (MOF publishes 100% compliance monthly). Private buyers have no equivalent. **The product is the backstop.**

### MyInvois as the data rail
- Phases: >RM100m Aug 2024 · RM25–100m Jan 2025 · RM5–25m Jul 2025 · **RM1–5m Jan 2026** · **RM500k–1m Jul 2026** · <RM500k exempt. 6-month grace per phase. Any sale >RM10k needs an individual e-invoice from Jan 2026. https://www.cleartax.com/my/en/different-phases-implementation-timelines-einvoicing-malaysia
- Fields: supplier & buyer TIN, SSM no., **supplier MSIC**, invoice **date and time**, line items, totals, optional **payment terms**, payment mode. **No due-date, no paid-date.** → payment status must come from the ledger / bank feed. Say this on stage; it's the honest architecture.
- SDK: https://sdk.myinvois.hasil.gov.my/ — Submit, Get Recent Documents (**sent or received**, 31-day window), Search Documents, Get Document Details. A supplier can observe its buyers' invoice flow to it, with consent.
- **Nobody builds receivables-side risk on it.** LHDN uses it for enforcement (52,540 taxpayers flagged, RM4.07bn). Lenders use bank statements (GXBank × CGC Digital; Boost; Funding Societies × Bukku). Pantas tried e-invoice → financing in 2022 and pivoted to carbon.
- **Why now:** BNM Governor, Aug 2026: e-invoice/transaction records "can now count toward your loan application… should support a lender's decision, not replace it." https://ringgitplus.com/en/blog/business-loan/bnm-says-e-invoices-could-help-sme-loan-approval.html

### Local tools: all report, none predict
| Tool | What it does for receivables |
|---|---|
| Bukku (~30k biz) | Aging, overdue, cash dashboard; embedded Funding Societies financing. No prediction. |
| SQL Account (~600k users), AutoCount (~200k), QNE, Biztory, Financio | Debtor aging, overdue reports, e-invoice submission. AutoCount "cash flow forecast" = deterministic from due dates. |
| Access UBS (100k+ SMEs) | E-invoicing compliance, dashboards. No predictive feature. |
| Xero MY | Forecasting only via global marketplace apps, not trained on Malaysian payers. |
| CTOS SME Score (FICO, 100–400) | Scores the SME's **own** borrowing risk from CCRIS/SSM/trade references. Not its customers. |
| Experian Trade Bureau | Sector-level days-to-pay benchmarks. Descriptive. |
| CapBay / Boost Credit | ML payment-risk scoring, **for the lender's book**, not for the SME managing receivables. |
| ZeroPilot AI, DashAdd | Ledger-based projections / AI analyst, early-stage, Xero-only or service-led. Not payer behaviour. |

**The gap in one sentence:** nobody in Malaysia gives an SME a per-customer, per-invoice probability of late payment before the due date, and nobody reads MyInvois flows to do it.

---

## 3. What to borrow from abroad

| Source | Mechanism | Use in KiraKira |
|---|---|---|
| **Chaser (UK)** | Payer Rating Good/Average/Bad per customer; per-invoice late probability; "recommended chasing time" learned from thousands of B2B payments (claims 78% on-time uplift) | Payer Rating badge; best-time-to-chase line |
| **Tesorio (US)** | LLM extracts promise-to-pay dates from debtor email replies (90% acceptance), feeds invoice-level forecast | Promise-to-pay from a WhatsApp reply in Manglish/BM |
| **QuickBooks Payments Agent (Jul 2025)** | Predicts late payments, picks acceleration strategy, sends reminders; "paid ~5 days faster" | Validation that the incumbent thinks this is the feature. Name them. Not in Malaysia. |
| **Fundbox / Stripe Capital / Shopify Capital** | Silent pre-qualification from ledger/processing data, offer surfaced in-app | "You qualify for ~RM X against invoice #123" in the ladder (Bukku × Funding Societies already proves the local flow) |
| **India: Crediwatch / Jocata / GST Sahay** | Early warning from GST e-invoice cadence; 2+ late filings in 6 months → 3.2× default | The MyInvois analogue: buyer's issuance volume slump as a signal (future) |
| **Ant MYbank "Goose" graph** | Supply-chain knowledge graph, shock propagation to 3rd-tier SMEs | Closing slide: contagion map from buyer→supplier TINs |
| **Academic** | Discrete survival model: P(paid by day t) instead of a point date | If time: fan chart instead of a single expected date. Optional. |
| 2025–26 wave: Fazeshift, Monk, Paraglide, Cleavr | Agentic / voice collections, mid-market, $5–25M rounds | Context for "where this goes." Not for the weekend. |

**"Why not just use X?"**
- *Xero/QuickBooks:* no Malaysian payer data, no MyInvois-native model, QuickBooks' agent isn't available here.
- *Chaser:* foreign, rules-based in Malaysia, no BM/Manglish, no local financing rungs.
- *CTOS:* scores you, not your customers.
- *ChatGPT:* can't score 200 invoices against history consistently or give a calibrated probability.

---

## 4. The idea, restated for the pitch

> **KiraKira: a credit score for your customers, built from your own invoices.**
> Every Malaysian business above RM500k now files every invoice to LHDN. We read that flow plus your ledger, predict which invoices will be paid late and by how much, rate each customer, tell you who to chase today and when to send it, turn their WhatsApp "bayar minggu depan" into a date, and if the cash still runs out, rank the cheapest money with an apply-by date. Never ah long.

Rubric mapping stays as in `kirakira-final.md` §3.

Startup path (closing slide, 15 seconds):
1. Plug-in for UBS / Bukku / SQL marketplaces (distribution, not sales).
2. Embedded financing referral revenue (lender pays per qualified lead; the Funding Societies × Bukku flow exists, we add the prediction).
3. **Payer bureau**: aggregate consented payer scores across suppliers → "CTOS for invoices," sold to lenders and accounting vendors. BNM is signalling e-invoice-based underwriting. That's the why-now.
4. Supply-chain contagion: warn a micro-SME when a Phase-1 buyer upstream starts slipping.

---

## 5. Money ladder rungs (sourced; label as estimates)

| Rung | Cost | Speed | Source |
|---|---|---|---|
| Chase top-N invoices (promise-to-pay) | 0 | days to due | — |
| Early-payment discount | 1–2% of invoice | immediate | your rule |
| **TEKUN Nasional** micro-financing | ~4% p.a. profit rate, RM1k–100k | weeks (est.) | https://bernama.com/en/general/news.php?id=2382122 |
| **BSN Micro** (TemaNiaga / TemanMesra) | from 6.38% p.a. | weeks (est.) | https://bsn.com.my/page/interest-rates |
| **SJPP-guaranteed working capital** (via bank) | bank rate + 0.5–1.0% p.a. guarantee fee; 70–90% cover | weeks–months (est.) | https://www.maybank2u.com.my/maybank2u/malaysia/en/business/financing/government_aided/business/SJPP_Schemes_SME_Working_Capital_Financing.page |
| **P2P invoice financing** (Funding Societies / CapBay) | ~1–1.5% per month (verify on site), 80% advance, 30–120 days | 3–7 days | https://help.fundingsocieties.com.my/en/articles/1015808-our-credit-assessment-explained |
| Credit card | ~18% p.a. | 0 | — |
| 🚫 Ah long | — | — | never |

Also citable: BNM-CGC Guarantee Scheme up to RM10bn (2026); SME Stabilisation Relief Facility 15 May–31 Dec 2026, up to RM750k at max 3.75% p.a.; Budget 2026 raised entrepreneur loan/guarantee facilities to RM50bn. https://www.bnm.gov.my/sme-financing

---

## 6. Promise-to-pay spec (the 2-hour wow)

```
POST /promise  { invoice_id, message: "Boss, minggu depan I settle half dulu ok, baki hujung bulan" }
→ { promises: [{ amount: 0.5*invoice, date: <next Mon>, confidence: 0.8 },
               { amount: 0.5*invoice, date: <month end>, confidence: 0.6 }],
    language: "ms-MY/manglish", tone: "cooperative" }
```
Claude prompt: extract promises as structured JSON; resolve relative dates against `today`; Malaysian English + BM idioms ("hujung bulan", "lepas gaji", "lepas Raya"); return confidence. Forecast uses promise date when confidence ≥ 0.6, else model date. Show both on the invoice card: "Model: 12 Nov · Customer promised: 3 Nov (0.8)."

Demo line: paste the message, watch the projection move. Khalil will like that it handles Manglish; Jack will like that the override is explicit and logged.

---

## 7. Honesty lines (say them before they're asked)
- "E-invoices don't carry paid dates. The ledger does. Our model needs both; MyInvois gives us the buyer identity and the invoice timing at national scale."
- "The demo business is simulated with planted patterns. The model's numbers come from a real public invoice dataset, time-split."
- "Best-time-to-chase is learned from our synthetic history; with real users it learns from theirs."
- "Rates on the ladder are public figures as of this week, labelled estimates. The owner verifies before applying."

---

## Sources (research agents, 10 Oct 2026)
Judges/sponsor: Mesolitica (TechNode Global, Tatler, The Edge), AI Tinkerers KL, The Star (Mar 2026) on AI Hackerdorm, Cleve (Crunchbase, The Runway), Prime Intellect site + AI Engineer SG 2026, The Access Group MY newsroom and product pages (UBS Evo, e-invoicing, KL GOC), aihackerdorm.com.
Market: Experian MY State of Credit 2025; Coface Asia Payment Survey 2025; DOSM MSME 2025; CPA Australia 2024-25/2025-26; Malay Mail Sep 2024; Bernama Jun 2026 (MyInvois volume); LHDN SDK; ClearTax/AutoCount/SQL on e-invoice fields; RinggitPlus Aug 2026 (BNM on e-invoice underwriting); Fintech News MY (Funding Societies × Bukku); CTOS SME Score; CapBay; Boost; BNM SME financing; BSN rates; SJPP.
Abroad: Chaser, Tesorio, HighRadius, Intuit press (Jul 2025), Xero, Fundbox (Pulse2), Stripe Capital docs, Fazeshift/Monk/Paraglide/Cleavr funding news, MYbank (BusinessWire, Leiphone), Qifu, Kingdee, Linklogis HKEX filing, Crediwatch/Jocata/GST Sahay, Xepelin, arXiv 2510.16066 (Malaysian bank-statement underwriting), arXiv 2511.03631, Springer AR survival model.
Unverified / treat carefully: Ace Yip's "Orbital" CEO title; Openclose Accounting (no web presence); Muthuraman's HackMIT win; MYbank's "95% accuracy" is their own claim.
