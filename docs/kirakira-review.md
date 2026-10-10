# KiraKira Plan Review vs Track 1 Requirements

**Taylor's Hackathon (Hackerdorm x BuilderX) · Track 1: Predictive Model Track**
Reviewed: Sat 10 Oct 2026, 12:37 · Source: `kirakira-TEAM-FINAL.md`

---

## 1. The idea in short

KiraKira is a credit score for a business's customers, built from its own invoices. It predicts which invoices will be paid late, rates each customer Good/Average/Bad, ranks who to chase by ringgit at risk, and reads WhatsApp promises like "bayar minggu depan" into dated promises. It projects cash 90 days out and suggests the cheapest funding with apply-by dates.

The user (Ah Seng, a printing shop owner), the problem, and the decision it supports are all concrete, which is what this track rewards.

---

## 2. Track 1 requirements (from the slides)

### Problem statement
1. How can AI and predictive analytics identify emerging risks, forecast future outcomes, and support timely, informed decisions before costly failures or losses occur?
2. Build an AI-powered solution that detects, predicts, or forecasts meaningful events from data and converts those insights into actionable decisions.

### Four required abilities
- **Detect:** predict failures, forecast future values, or identify unusual patterns.
- **Categorize:** explain what type of issue was found, not just that something is abnormal.
- **Prioritize:** rank findings by business impact, financial cost, operational risk, or urgency.
- **Explain:** clear reasoning that lets non-experts act confidently.

### What makes a strong solution
- Solves a specific, real-world problem
- Clearly identifies the user who benefits
- Supports decision-making, not just prediction
- Performs robustly on noisy or unfamiliar data
- Minimizes false alarms
- Clearly communicates recommendations and reasoning
- Demonstrates measurable impact through realistic assumptions

**Core judging question:** *Does your model help someone make a better decision, and can you prove it?*

### Competition rules
- **Deadline:** Sunday 11/10/2026, 9:30 AM sharp, with a strict 30-minute buffer (treat **9:00 AM** as the real cutoff).
- **Submit:** public GitHub link, deployed application link, presentation slides (PDF), group name and campus branch.

---

## 3. Four abilities: plan vs requirement

| Ability | Plan | Verdict |
|---|---|---|
| **Detect** | P(late) and days-late per invoice, plus a 90-day cash projection | ✅ Matches |
| **Categorize** | Six rule-based tags (Chronic late payer, Seasonal risk, etc.) | ⚠️ Matches, with caveats |
| **Prioritize** | Cash at risk = amount x P(late) | ⚠️ Mostly, one mismatch |
| **Explain** | SHAP top-3 turned into one sentence in BM/EN | ✅ Matches, ownership overlap |

- **Categorize:** the tags are hand-written rules, not model output. That is acceptable, but "first match wins" hides invoices with multiple causes. "Chronic late payer" also duplicates the "Bad" rating. The only real "unusual pattern" detection is one rule (amount > 1.8x customer median).
- **Prioritize:** the rubric table promises "days-until-it-hurts", but the formula only uses days-to-due as a tie-break. Either implement it (rank by impact on the danger date from the cash projection) or drop the claim.
- **Explain:** the ML person writes SHAP sentences while Backend uses Claude to "phrase reason" in `llm.py`. Pick one owner and one method, preferably templates from SHAP with Claude only polishing.

---

## 4. "What makes a strong solution" checklist

| Criterion | Status |
|---|---|
| Specific real-world problem | ✅ |
| Clear user who benefits | ✅ |
| Supports decisions, not just prediction | ✅ Strongest point |
| Robust on noisy or unfamiliar data | ❌ Weak |
| Minimizes false alarms | ⚠️ Partial |
| Communicates recommendations and reasoning | ✅ |
| Measurable impact, realistic assumptions | ⚠️ Partial |

### Gaps, in priority order

1. **The proof doesn't show the decision gets better.**
   The core question is whether the model helps someone make a better decision, provably. The current proof (AUC, precision/recall, top-20% capture) only shows the ranking works.
   **Fix:** add a policy backtest on the test period. Chase the model's top N versus baselines (largest invoices first, oldest overdue first, random) and compare late ringgit caught. State your assumption about how much chasing speeds up payment, since the data can't measure that.

2. **Robustness is claimed, not tested.**
   A time split only shows generalization over time.
   **Fix:** add a hold-out-customers split, a missing-value/noise check, and cold-start behavior for new customers. Confirm whether organizers will test on a hidden dataset; if so, you need a way to score an uploaded CSV in the same schema.

3. **The model and the demo may be disconnected.**
   You train on Kaggle data but demo on simulated Ah Seng data with planted patterns. It's unclear whether the model actually scores Ah Seng's invoices, or whether the features map between the two schemas. Planted patterns also make any demo accuracy circular, so don't quote it.
   **Fix:** decide explicitly, and document the feature mapping.

4. **False-alarm handling is thin.**
   - The action thresholds (0.7, 0.5, 0.3) are arbitrary; tune them on a validation set.
   - The action table has gaps: p = 0.4, or p >= 0.5 with due <= 14 days but p < 0.7, has no defined action.
   - Chronic late payer -> "Deposit" conflicts with p < 0.3 -> "No action".
   - **Fix:** add rule ordering, and cap the chase list (e.g. top 5 per day) so it can't flood the user.

5. **Data leakage and censoring risks.**
   Invoices still unpaid at the dataset's end can't be labeled "on time", and the last 20% test slice will contain many of them. Customer features and the 12-month rating must be computed strictly as of each invoice date.

---

## 5. Other mismatches to fix

- **The persona undercuts the pitch.** Ah Seng earns RM40k/month (about RM480k/year), which is below the RM500k MyInvois threshold the pitch relies on. Raise his revenue above that, or reframe the pitch.
- **Verify claims before they go on slides:** MyInvois phase dates, "BNM says e-invoice records now count toward loans", Experian 64 days, Coface 40%, DOSM 39.7%, and "no prompt-payment law in Malaysia". CIPAA covers construction, so the last claim as written is likely too absolute.
- **Scope is heavy for about 20 hours.** The ladder, promise-to-pay, cash projection, and Claude integration go beyond what the track requires. Protect the four abilities and the proof page first. The ladder's rates are "estimates", which invites Q&A attacks, so label them clearly.
- **Housekeeping:** keep the Claude API key out of the public repo, check the Kaggle dataset licence, and keep canned-message fallbacks for the live promise-to-pay demo.

---

## 6. What already matches

- All four submission items are covered: public GitHub, deployed link, PDF slides, team name plus campus.
- The 08:30 submit and 09:00 hard buffer fit the 09:30 deadline with its 30-minute buffer.
- The "No action" bucket, real-vs-synthetic disclosure, and precomputed JSON fallback are all good calls.

---

## 7. Suggested next steps

1. Design the policy backtest (gap #1) so the proof page answers the core judging question directly.
2. Add robustness checks (gap #2) and decide how the model scores the demo data (gap #3).
3. Tidy the action rules: full coverage, ordering, tuned thresholds, daily cap (gap #4).
4. Fix the persona revenue and verify every statistic on the slides.
