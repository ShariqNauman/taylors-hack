# Dormathon 2026 — Hackathon Brief (verbatim from organiser slides, 10 Oct 2026)

Organiser: AI Hackerdorm × BuilderX. Campuses: Taylor's University (ours), UPM, Swinburne Sarawak. Sponsors: The Access Group (title), Tencent Cloud / WorkBuddy, Grafilab, Kiro.

## Event facts
- 24-hour hackathon, Sat 10 Oct – Sun 11 Oct 2026. Teams of 1–4.
- Sat: 09:00 registration · 09:30–11:00 opening · 11:00–12:00 preparation · 12:00–13:00 lunch · 13:00–18:30+ hacking (continues overnight).
- Sun: **09:00–09:30 SUBMISSION DEADLINE** (slides say "Sunday 11/10/2026, 9:30 AM SHARP. A strict submission buffer will be enforced 30 minutes before the deadline" → treat **09:00 as the cutoff; we submit 08:30**). 09:30–10:00 briefing · 10:00–13:00 Phase 1 pitching · 13:00–14:00 lunch + branch deliberation · 14:15 top-18 announced · 14:20–16:45 Phase 2 global sync demos · 16:45–17:00 top-3 deliberation · 17:00 results.
- AI tools explicitly allowed ("Teams are permitted and encouraged to use AI tools for assistance (e.g., Cursor AI)").
- GitHub link must be PUBLIC. Taylor's guest Wi-Fi. 2 power outlets per team; no personal extension cords.

## Submission requirements (each team must submit)
1. GitHub link (PUBLIC)
2. Deployed application link
3. Presentation slides (PDF)
4. Group name & campus branch

## Pitching format
- **Phase 1, local branch:** 5 minutes per team = **3 min live presentation + 2 min Q&A**, in person to branch judges.
- **Top 18 shortlisted across all chapters.**
- **Phase 2, global sync:** top 18 pitch on a **live sync video call**, 7 minutes = **4 min demo + 3 min Q&A**.
- Top 3 selected purely on merit across the 3 branches.

## Track 1: Predictive Model Track — "Predict Early, Decide Better"
**Theme:** How can AI spot problems before they become expensive, and help someone decide what to do about them?

**Problem statement & expected outcome:**
1. How can we leverage AI and predictive analytics to identify emerging risks, forecast future outcomes, and support timely, informed decision-making before costly failures or losses occur?
2. Develop an AI-powered solution that detects, predicts, or forecasts meaningful events from data and converts those insights into actionable decisions.

**EVERY SOLUTION SHOULD DEMONSTRATE THE ABILITY TO:**
- **Detect:** Predict failures, forecast future values, or identify unusual patterns.
- **Categorize:** Explain what type of issue has been detected, not simply that something is abnormal.
- **Prioritize:** Rank findings based on business impact, financial cost, operational risk, or urgency.
- **Explain:** Provide clear, understandable reasoning that allows non-experts to take action confidently.

**A STRONG SOLUTION SHOULD:**
- Solve a specific, real-world problem
- Clearly identify the user who benefits from the solution
- Support decision-making, not just prediction
- Perform robustly on noisy or unfamiliar data
- Minimize false alarms
- Clearly communicate recommendations and reasoning
- Demonstrate measurable impact through realistic assumptions

**CORE JUDGING QUESTION: "Does your model help someone make a better decision, and can you prove it?"**

**Suggested applications (encouraged, not required):** predictive maintenance & industrial intelligence · supply chain anomaly detection · quality & defect prediction · renewable energy forecasting & optimization · battery charging & maintenance planning · financial audit & fraud detection.

**Tools:** tool-agnostic. Optional Kiro credits (claimed before 10 Oct) and Grafilab credits (given on the day).

## Track 2 (not ours, for context)
WorkBuddy agentic track; must use Tencent WorkBuddy for everything. Judged on real problem/user value, agentic workflow, meaningful WorkBuddy use, end-to-end execution, usable results.

## Prizes (Track 1)
Top 1: RM1,200 + 2 AirPods + power bank · 1st runner-up: RM1,000 + RM500 Tencent Cloud voucher · 2nd runner-up: cash + RM500 voucher.

## Judges, Taylor's branch (Phase 1)
| Judge | Background (public) | Likely to probe |
|---|---|---|
| Shannon Choo | Co-founder & President, AI Hackerdorm; City Lead, AI Tinkerers KL ("demo-first, no-pitch" culture); ex-YTL AI Labs; listed with "Openclose Accounting" (no public footprint) | Does it run live? Is the accounting problem real? |
| Khalil Nooh | Co-founder & CEO, Mesolitica (Malay-first LLMs, MaLLaM; B2B voice agents; bootstrapped). Public views: domain knowledge beats coding; AI should run in Malaysia; enterprises lack data-ready systems | Local language, sovereignty, user understanding |
| Jack Min Ong | Founding Research Engineer, Prime Intellect (decentralised RL, verifiable inference); "make throughput visible, benchmark trade-offs" | Leakage, splits, calibration, honest numbers |
| Ashvin Praveen | Co-founder & CEO, Cleve.ai (40k users, Antler); product designer; NAIC director; "recognisability beats cleverness", mobile-first | Would a real user use this tomorrow? UX clarity, distribution |
| Jing Yuan Phen | Taylor's; 55 placements across 35 hackathons; openly shapes projects to the panel | Fit to brief, strategic framing, presentation craft |
| Muthuraman Palaniappan | Taylor's student; MIT Hacking Medicine 2026 winner (early-detection prototype); "competitions test whether an idea survives contact with reality" | Early-detection credibility, real user |
| Andrew Gostishchev | Senior SWE / independent AI researcher; publishes honest negative results | Reproducibility, stated limitations |
| Ace Yip | Young serial builder (edtech, live-commerce AI); "Orbital" title unverified | Product/GTM energy |

Mentors overlap (Khalil, Muthuraman, Andrew, Ashvin) plus Hong Bing Sim (AI Hackerdorm co-founder; Tack, CodeKite; reliability-minded) and Mohtasham Madani.

## Title sponsor: The Access Group (Malaysia)
Owns **Access UBS** (bought Sage Asia 2021): Malaysia's dominant SME accounting software, 100k+ SMEs, 30k active on LHDN e-invoicing, free e-invoice submission. Ships dashboards/"Copilot"/"Actionable Insights" but **no predictive feature**. Positions "private AI": data stays in Malaysia, no training on customer data, ISO 42001, "humans interpret, AI assists". KL Global Operations Centre targets 1,000 staff by 2027; hackathon is partly a hiring pipeline. Their blog frames SME pain as: small firms lack data for analytics, fear data exposure, staff resist AI.

## Organiser culture
AI Hackerdorm / AI Tinkerers KL: "screened, demo-first, no-pitch". Proxy judging criteria from their past events: problem clarity, solution/tech quality, impact & scalability. Slides-only loses; a working deployed demo wins.

## How KiraKira maps (see docs/kirakira-TEAM-FINAL.md §1)
Detect = P(late) + cash projection · Categorize = 6 invoice tags · Prioritize = cash at risk, pushes-red flag, 5/day cap · Explain = SHAP → one BM/EN sentence · Decide = action per invoice, draft & send (owner taps), money ladder with act-by dates · Prove = time + unseen-customer splits, calibration, policy backtest, real-invoice slice · False alarms = No-action bucket, tuned threshold · Unfamiliar data = customer split, cold start, real UK-council invoices · Impact = policy chart with stated assumptions.
