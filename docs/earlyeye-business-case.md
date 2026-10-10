# EarlyEye — Business Case

*Dormathon 2026 · Track 1 · prepared 10 Oct 2026. Sourced figures carry a source; everything marked **(A)** is an assumption to be replaced by pilot data. FX ≈ RM4.10/USD.*

---

## 1. Executive summary

Every site with a security desk has the same problem: one operator, thirty screens, and the camera only matters after the incident. EarlyEye runs on the cameras a site already owns, scores physical aggression *as it builds*, tells the one person on duty where to go and why, and turns weeks of incidents into a patrol plan. Skeletons, never faces; video never leaves the site.

- **Wedge:** university campuses and hostels (24/7 control rooms already staffed, adults, opex budgets). Pilot target: Taylor's Lakeside.
- **Expansion:** private day schools → malls, factories, transit → government school hostels (533 sites funded under the RM15k-per-set programme) once night/IR performance is proven.
- **Model:** RM45 per camera per month on existing CCTV, per-site pricing inside government budgets; ~73% steady-state margin on subscriptions.
- **Ask (seed):** RM1.2M for 18 months → 3 paid pilots → 25 sites → first government tender. Details in §9.

---

## 2. Problem and why now

| Fact | Source |
|---|---|
| School bullying cases: 3,883 (2022) → 6,528 (2023) → 7,681 (2024); >70% secondary. 2025: 5,038 in government schools. | NST Sep 2025; FMT Feb 2026 |
| Penal Code (Amendment) Act 2025, ss.507B–507G: bullying is a crime, in force 11 Jul 2025 | Bernama / SAYS |
| Hostel CCTV programme: RM3M for 200 dormitories (2025) + RM5M for 333 boarding schools (2026), ~RM15k per set | FMT; Utusan |
| Ministry audit of 54 boarding schools: only 24 had properly working CCTV | theSun |
| Malaysia CCTV camera market: USD 648M (2025), 18.3% CAGR to 2034 (~RM2.7B) | IMARC |
| Security guard minimum wage RM1,700; 24/7 post ≈ 3 guards ≈ RM103.5k/yr with on-costs (A) | SAYS; Maukerja |
| Incumbents moving: Verkada fighting detection in beta (Feb 2026, own hardware only); Volt AI ~USD 385/stream/yr in US schools, human validators | Verkada; EdWeek |

**Why now, in one line:** cameras are being bought faster than anyone can watch them, the law now makes institutions accountable, and the global incumbents sell hardware-locked, US-priced products with no Malaysian presence.

---

## 3. Product and value by segment

Same engine, different zone thresholds and buyer.

| Segment | Buyer | Pain they pay for today | EarlyEye value | Priority |
|---|---|---|---|---|
| **Universities + hostels** | Campus security manager | Control room staffed 24/7 but can't watch 60+ screens; hostel incidents; duty of care | Ranked screens, one person dispatched, patrol plan, camera health | **1** |
| Private / international day schools | Principal / bursar | Reputation; one viral incident costs enrolments (median intl tuition ~RM49k/yr) | Daytime canteen/stairwell coverage; weekly report for parents' trust | 2 |
| Malls, transit, stadiums | Operations / security head | Guard cost, crowd incidents, liability | Crowd + fight detection with zone thresholds; dispatch | 3 |
| Factories, logistics yards | HSE manager | Altercations, loading-bay crowding, insurer requirements | Same engine; incident records for HSE audits | 3 |
| Government school hostels | KPM / state education dept | 533 funded sites; cameras nobody watches at night | Vision; requires IR-trained model and tender | 4 |

**What the customer actually buys:** fewer serious incidents, faster response, a patrol plan that replaces guesswork, and an audit trail. The alarm sells it; the weekly plan and camera-health tile keep it open.

---

## 4. Market sizing (serviceable, illustrative)

| Segment | Sites | Cameras/site (A) | Annual revenue at RM45/cam/mo, 100% | Source for site count |
|---|---|---|---|---|
| Universities with hostels | ~100 (A: 20 public + ~50 private universities + large colleges) | 60 | ~RM3.2M | (A) verify against MOHE list |
| International schools | 348 | 40 | ~RM7.5M | Straits Times via AsiaNews |
| Government hostels (programme) | 533 | 16 | ~RM4.6M | FMT / Utusan |
| Malls (major) | ~400 (A) | 60 | ~RM13M | (A) verify PPK Malaysia |
| **Serviceable total** | | | **~RM28M/yr (A)** | |

SOM in 3 years: 60 sites, ~1,680 cameras, ~RM907k ARR (market doc model) ≈ 3% of the above. Realistic, not heroic.

---

## 5. Business model and pricing

- **Subscription:** RM45 per camera per month, software on existing CCTV. 40 cameras ≈ RM1,800/month.
- **Setup fee:** Option B (recommended): hardware at cost, ~RM620 per camera (edge box ~RM2,036 per 4 streams (A, unbenchmarked) + install/calibration). Payback 6–10 months vs 17–26 months with a nominal fee.
- **Government:** per-site pricing designed to fit inside the RM15k set budget; lease the edge box.
- **Positioning vs competitors:** ~66% below Volt AI (~RM132/cam/mo), ~34% below Verkada's licence alone before hardware; Hikvision/Dahua bundle basic alarms free but no build-up scoring, no explanation, no patrol plan, and lock you to their cameras.
- **Later revenue:** insurer partnerships (premium discounts for monitored sites, A), camera-health monitoring as a standalone SKU, weekly-report tier.

---

## 6. Financials

### 6.1 Unit economics per site (market-doc model, A)

| | 16-camera hostel | 40-camera campus/school |
|---|---|---|
| Upfront cost to us (edge boxes + install + training) | RM10,604 | RM24,259 |
| Monthly revenue | RM720 | RM1,800 |
| Monthly running cost (cloud RM30 + RM2/cam, LLM ~RM25, support RM225/site) | RM312 | RM360 |
| Monthly contribution | RM408 (57%) | RM1,440 (80%) |
| Payback, subscription only | 26 months | 17 months |
| Payback with setup fee at hardware cost | 10 months | 6 months |

### 6.2 Three-year P&L (Option B, A)

| | Y1 | Y2 | Y3 |
|---|---|---|---|
| New sites | 5 | 15 | 40 |
| Revenue | RM125k | RM451k | RM1.30M |
| Cost (staff 0/2/4 at RM4.5k loaded, overhead, S&M, hardware) | RM124k | RM474k | RM1.17M |
| Profit | +RM1k | −RM23k | +RM132k |
| End-Y3 ARR | | | ~RM907k |
| Steady-state subscription margin | | | ~73% |

Assumptions: founders unpaid Y1; 50/50 mix of 16- and 40-camera sites; no tax, financing or tender delays. **Sensitivity that matters most:** streams per edge box (4 assumed). At 8 streams, upfront cost halves and payback drops under 4 months; at 2, the model breaks. Benchmark this in week one.

### 6.3 Customer ROI (what the buyer's CFO sees)

- One manned 24/7 post ≈ RM103.5k/yr (A). EarlyEye for 40 cameras ≈ RM26.9k/yr incl. amortised setup: ~26% of one post, covering 40 screens instead of one.
- International school: break-even at **0.55 of one retained student per year** (A).
- Incident break-even: at RM10k per serious incident (A), 2.7 prevented incidents/yr on 40 cameras.

---

## 7. Operations

### 7.1 Deployment playbook (per site, 3 weeks)
1. **Site survey (day 1–2):** camera inventory (RTSP access, angles, lighting), zone map, control-room workflow, who receives pushes.
2. **Edge install (day 3–5):** one box per 4 streams, on the site LAN, video never leaves. Dashboard deployed to the site's tenant.
3. **Tuning (week 2):** 2 weeks of "tense-only" silent mode; thresholds tuned per camera on real footage; operators mark false alarms (labels).
4. **Go-live (week 3):** two-tier alerts on; target ≤3 pushes per shift; weekly plan generated from week 4.
5. **Review (day 30, 90):** false alarms/camera-day, response time, incidents by zone, patrol plan adherence.

### 7.2 Team to run 25 sites (A)
Founders (product, ML, GTM) + 1 field engineer (installs, tuning) + 1 support/CS (RM4.5k loaded each). One field engineer handles ~2 installs/week.

### 7.3 Data flywheel
Every Confirm/Dismiss is a labelled window from that camera. Per-site thresholds retrain monthly; cross-site model retrains quarterly on consented, skeleton-only data. After 12 months no competitor has Malaysian-campus labels at this volume.

### 7.4 Key operating metrics
False alarms per camera-day · pushes per shift · median response time · incidents per zone per week · patrol-plan adherence · camera uptime · labels collected.

---

## 8. Risk register and mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Domain shift** (trained on phone video, deployed on CCTV) | High | High | Held-out CCTV-domain test; 2-week silent tuning per site; per-camera thresholds; report live numbers |
| **Night / IR footage** | High | High for hostels | Start with daytime, control-room segments; IR-trained model as a funded milestone; never claim night until measured |
| **Alert fatigue** | High | Fatal to retention | Two-tier alerts, ≤3 pushes/shift target, "tense" never pings, labels retune per camera, Volt-style human validation as a paid tier later |
| **Incumbent bundling** (Hikvision/Dahua analytics in the RM15k sets) | Medium | Medium | Camera-agnostic; sell build-up scoring, explanation, patrol plan, camera health; partner rather than fight on alarms |
| **Edge hardware cost / streams per box unbenchmarked** | Medium | High | Benchmark week 1; hardware-at-cost setup fee; lease option for government |
| **Procurement cycles** (government, universities) | High | Medium | Private pilots first; universities via security managers' opex; government after pilot evidence |
| **PDPA / child data / surveillance optics** | Medium | High | Skeleton-only, on-site processing, no identities, auto-delete clips, DPIA template for each site, human always decides |
| **Liability on a missed incident** | Low | High | Contract: assistive tool, adds eyes, never replaces staff; logs show what was flagged and when |
| **Misuse** (monitoring staff, profiling) | Low | High | No identity features by design; zone-based only; audit log; refuse deployments aimed at individuals |
| **Team execution** (student founders) | Medium | Medium | Advisors from campus security + one accounting/finance mentor; milestone-based funding |

---

## 9. Investor case

### 9.1 The pitch, 60 seconds
"Malaysia is installing cameras faster than anyone can watch them. Every campus, mall and factory already pays for a control room that sees an incident only after it's over. EarlyEye makes those cameras watch themselves: it scores a fight while it's building, tells the one person on duty where to go, and turns a month of incidents into a patrol plan. Skeletons, not faces, nothing leaves the site. It costs a quarter of one guard post, runs on cameras they own, and every alert the operator confirms makes it better on that site. The US incumbents are hardware-locked and three times the price; nobody local does early warning. We start with university campuses, where the control room is already awake, then schools, then the 533 government hostels the ministry just funded."

### 9.2 Why this wins
1. **Timing:** CCTV spend growing 18%/yr; bullying now criminal; incumbents just started shipping fight detection (Verkada beta Feb 2026) but hardware-locked.
2. **Wedge with a receiver:** we sell where a human is already watching, so the product is adopted, not shelved.
3. **Moat that compounds:** per-site labels + skeleton-only privacy design that passes institutional review where face-based vendors can't.
4. **Unit economics that work:** 73% steady-state margin; 6–10 month payback with hardware at cost.
5. **Decision product, not alarm product:** the patrol plan and camera-health tile are why sites renew.

### 9.3 Ask and use of funds (seed, A)
**RM1.2M for 18 months.**
- 40% engineering: IR/night model, multi-camera edge, label pipeline (2 engineers)
- 25% field + support: 1 field engineer, 1 CS, edge hardware for pilots
- 20% GTM: 3 paid pilots (campus, international school, mall), one government tender response
- 15% compliance + runway: DPIA templates, legal, buffer

### 9.4 Milestones investors can check
| Month | Milestone |
|---|---|
| 0 | Dormathon prototype: live detection, deployed dashboard, proof page |
| 3 | Taylor's Lakeside pilot live on 20 cameras; false alarms/camera-day and response time measured |
| 6 | 3 paid pilots; IR model v1 measured on real night footage |
| 9 | 10 sites; first mall; camera-health SKU |
| 12 | 25 sites, ~RM400k ARR (A); government tender submitted |
| 18 | 40+ sites; Series A conversation on Malaysian-campus label dataset + ARR |

### 9.5 Comparables
Volt AI (US, school districts, 5-year USD1.1M contract with one county); Verkada (fighting detection beta, hardware-locked); Hikvision/Dahua (bundled alarms). Nearest Malaysian analogue: none in early-warning; CCTV integrators sell installation, not intelligence.

### 9.6 What we'll say we don't know
Streams per edge box; night/IR accuracy; real-world false-alarm rate beyond our own footage; government tender timelines. Each is a funded milestone, not a hidden assumption.

---

## 10. Case study (illustrative, labelled as such on every slide)

**Pilot: Taylor's Lakeside Campus, Block C + hostel, 40 cameras, 8 weeks.** (Hypothetical scenario built from the fake incident history; replace with pilot data.)

| | Before (A) | After 8 weeks (A, target) |
|---|---|---|
| Screens per operator | 40 | 40, ranked; 2–3 pushes per shift |
| Median time from incident start to a person arriving | ~6 min (operator notices late) | ~90 s (pushed at fight_likely) |
| Incidents at Block C stairwell, Mon–Thu 13:00–14:00 | 5 in 4 weeks | 2 in 4 weeks after one scheduled patrol hour |
| False alarms per camera-day | — | 0.4 after 2-week tuning |
| Cameras found dead | unknown | 3 flagged in week 1 |
| Cost | 1 post ≈ RM8.6k/month | RM1,800/month + setup |

**Narrative for the slide:** "In week one the dashboard found three dead cameras nobody had noticed. In week four the patrol plan moved one guard to the Block C stairwell at lunch; incidents there dropped from five to two. Operators went from watching forty screens to acting on three pushes a shift."

A second, one-line case for the mall segment: loading-bay crowding at 22:00 flagged → one guard repositioned → zero incidents in the following month (A).

---

## 11. Implementation roadmap and urgency

| Phase | When | What | Why the clock matters |
|---|---|---|---|
| 0. Prototype | Oct 2026 (this weekend) | Live detection, deployed dashboard, proof page, pilot ask | — |
| 1. Campus pilot | Nov 2026 – Jan 2027 | Taylor's Lakeside, 20 → 40 cameras; measure FA/day, response time, labels | Pilot evidence before the 2026 hostel programme (333 sites) finishes installing |
| 2. Paid pilots | Feb – May 2027 | 1 international school, 1 mall; IR model v1 on real night footage | Verkada's fight detection exits beta; be in-market with Malaysian references first |
| 3. Scale | Jun – Dec 2027 | 25 sites; field engineer; camera-health SKU; government tender | Budget 2027 cycle; state education departments plan Q4 |
| 4. Platform | 2028 | Multi-site tenants, insurer partnerships, SEA (Indonesia/Philippines have the same camera-and-guard structure) | |

**Urgency, honestly stated:** the window is 12–18 months. The government is buying cameras now; incumbents are adding fight detection now; neither has a Malaysian early-warning product with explanations and a patrol plan. After that window, this becomes a feature inside a camera vendor's suite and the independent play is gone.

---

## 12. Future product and startup shape

- **Incident intelligence for any camera estate**: the real product is the record + plan layer, not the detector. Detectors become plug-ins: aggression (now), crowding, falls (elderly care, hospitals), PPE compliance (factories), loitering (transit).
- **Camera health as the Trojan horse**: boring, universal, and the reason the dashboard stays open; upsell intelligence on top.
- **Insurance channel**: monitored sites get premium relief; insurer pays part of the subscription (A, needs one insurer conversation).
- **Regional**: Indonesia and the Philippines have the same guard-heavy, camera-rich, under-watched sites. Skeleton-only design travels across privacy regimes.
- **Exit paths**: acquisition by a regional integrator or camera vendor needing a software layer; or a security-SaaS roll-up. Comparable: Volt AI's district contracts; Verkada's analytics bundle.

---

## 13. KPIs for the next 90 days
1. Streams per edge box benchmarked (target ≥4)
2. False alarms per camera-day after tuning (target ≤0.5)
3. Pushes per shift (target ≤3)
4. Median response time on the pilot (target ≤2 min)
5. Labels collected (target 500)
6. Signed pilot LOIs (target 3)
7. IR model measured on ≥1 h of real night footage

---

## Sources
NST (bullying 2022–24) · FMT (2025 cases; hostel CCTV funding) · Utusan (CCTV per-set cost, 75% installed) · theSun (boarding-school audit; 10,245 schools) · Bernama / SAYS (Penal Code A1750) · Straits Times via AsiaNews (348 international schools) · IMARC (Malaysia CCTV market) · EdWeek, Northern Virginia Magazine, Volt AI (pricing, Loudoun contract) · Verkada blog (fighting detection beta) · CheckThat (Verkada pricing) · CNX Software (Jetson price) · SAYS, Maukerja (guard wages) · Schoozy (international school fees) · PwC / Alannah & Madeline Foundation (Australian cost of bullying; not Malaysian). Full URLs in `EarlyEye_Market_Competitor_Financial_Plan.md`.
