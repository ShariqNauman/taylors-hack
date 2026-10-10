# KiraKira Plan Review v2: Remaining Problems

**Taylor's Hackathon (Hackerdorm x BuilderX) · Track 1: Predictive Model Track**
Reviewed: Sat 10 Oct 2026, 12:47 · Source: `kirakira-TEAM-FINAL-FINAL.md`
Compared against: `kirakira-review.md` (first review)

---

## 1. Verdict

The updated plan closes most of the first review's gaps. The proof page now answers the core judging question ("does it help someone make a better decision, and can you prove it?") with a policy backtest, and the false-alarm handling, categorization, and data-schema problems are fixed.

**Seven problems remain**, some of them new ones introduced by the edits. Issues 1 and 4 matter most: issue 1 is a logic error that would show up in the live demo, and issue 4 is an easy attack in Q&A.

---

## 2. Status of earlier problems

| Earlier problem | Status | Where |
|---|---|---|
| Proof doesn't show a better decision | ✅ Fixed | Policy backtest (model top-5 vs largest, oldest, random), assumption stated, on proof page and in pitch |
| Robustness only claimed | ⚠️ Mostly | Hold-out-customer split, 20% nulling test, cold-start AUC added. Hidden-dataset path still missing (issue 5) |
| Model and demo disconnected | ✅ Fixed | One `features.py` for both datasets, matching schema, "never quote accuracy on the demo book" |
| Thin false-alarm handling | ✅ Fixed | Tuned thresholds, complete ordered action table, 5-per-day cap, separate customer-level note |
| Leakage and censoring | ✅ Fixed, one caveat | Censoring rule and as-of-issue-date features added (caveat in issue 2) |
| Categorize hides multi-cause | ✅ Fixed | Up to two tags per invoice |
| "Days-until-it-hurts" unimplemented | ✅ Fixed | Red-zone flag pins invoices to the top of the list |
| Explain ownership overlap | ✅ Fixed | ML owns the SHAP template, Claude only polishes |
| Persona below RM500k threshold | ⚠️ Changed, not verified | Now RM65k/month. See issue 6 |
| Unverified statistics | ⚠️ Partial | CIPAA claim fixed, re-verify instruction added. BNM, Experian, Coface, DOSM figures still unverified |
| Scope too heavy | ⚠️ Partial | Build order and cut order added, but ML workload grew (issue 7) |
| API key, licence, canned messages | ✅ Fixed | All on the submission checklist |

---

## 3. Open problems

### Issue 1: Overdue invoices break the model's logic (HIGH)
An invoice that is already past due and unpaid is late by definition, so P(late) is trivially 1. Action rows 1 and 2 ("Escalate", "Chase now" for already-overdue invoices) use `p` on overdue invoices, which tells the user nothing. The policy backtest has the same risk if predictions are made after the due date.

**Fix:**
- Define the **prediction point** as the issue date, refreshed up to the due date.
- For overdue invoices, stop using P(late). Rank them by the days-late regressor, expected pay date, or days overdue x amount.
- In the policy backtest, only use predictions made **before** the due date.
- Update action rows 1 and 2 so overdue handling uses days overdue and amount, not `p`.

### Issue 2: Leakage caveat in customer features (MEDIUM)
"History strictly before this invoice's issue date" is ambiguous. If a prior invoice was issued before this one but settled *after* it, its paid date leaks future information into the features.

**Fix:** customer features (late share, mean days-to-pay, open balance, rating) may use only invoices **settled before this invoice's issue date**. Invoices still open at that date count only toward open balance, not toward late share or days-to-pay.

### Issue 3: Policy backtest needs a precise definition (MEDIUM)
"Late ringgit that ends up on the chase list within 7 days of due" is fuzzy. It is also unclear whether a top-5-per-day list has enough cases to mean anything on a small dataset such as the roughly 2.5k-row IBM one.

**Fix:**
- Metric: **share of eventually-late ringgit that appeared in the daily top-5 before its due date.**
- Run the same metric for all four strategies (model, largest, oldest, random), with random averaged over many seeds.
- Check the number of late invoices in the test period before committing to top-5. If too few, scale N to the volume or report coverage at several N values.
- Keep the proof-page assumption wording: coverage, not recovery.

### Issue 4: A pitch line contradicts your own disclosure (HIGH)
The 2:30 pitch line says "Every other team's data is from Kaggle. Ours is a national data rail that didn't exist last year." Your training data *is* Kaggle and your demo data is simulated, so a judge can attack this directly.

**Fix:** reword so MyInvois explains why this is **deployable now**, not what you trained on. For example: "We trained on public invoice data to prove the method. MyInvois is why this can run on every Malaysian business's real invoices from now on."

### Issue 5: No unfamiliar-data path (MEDIUM)
The slide says solutions should perform robustly on "noisy or unfamiliar data". If organizers test on a hidden dataset, there is no way to score it.

**Fix:**
- Ask the organizers whether a hidden test set is used and in what format.
- If yes, add a small script or upload that scores a CSV in the `features.py` input schema.
- If a second dataset exists, add a train-on-A, test-on-B result to the proof page.

### Issue 6: Re-check the MyInvois threshold and the "micro" label (MEDIUM)
Raising Ah Seng to RM65k/month (about RM780k/year) only helps if the pitch's "RM500k / Phase 5" rule is correct. This has not been verified. Separately, the doc still calls him a "micro-business", and RM780k a year is probably "small" under Malaysian SME definitions.

**Fix:**
- Check LHDN's official MyInvois phase table: confirm the revenue threshold, phase dates, and any exemption level.
- If the threshold is different, adjust Ah Seng's revenue or reframe the pitch.
- Align the wording (micro vs small) with the official SME definition.
- Verify the remaining statistics (BNM e-invoice and lending, Experian 64 days, Coface 40%, DOSM 39.7%) against their source URLs before they go on a slide.

### Issue 7: ML is overloaded (MEDIUM)
ML now owns the dataset, features, two splits, robustness checks, threshold tuning, the policy backtest, SHAP templates, rules, and the export, with numbers due at 19:00.

**Fix:**
- Hand the **policy backtest** to another person (Pitch or Backend), using the model's saved predictions.
- If time runs short, drop the 20% nulling test first, then keep the cold-start check.
- Keep the "never cut the proof page" rule, but cut order should name which proof checks go first.

---

## 4. Priority order

| Priority | Issue | Effort |
|---|---|---|
| 1 | Issue 1: overdue logic and prediction point | 30-45 min (rewrite action rows 1-2, define prediction point) |
| 2 | Issue 4: pitch line contradiction | 5 min |
| 3 | Issue 6: verify MyInvois threshold and statistics | 20-30 min |
| 4 | Issue 3: precise policy backtest definition | 20 min |
| 5 | Issue 2: settled-before-issue leakage rule | 10 min |
| 6 | Issue 5: ask organizers about hidden data | 5 min to ask |
| 7 | Issue 7: rebalance ML workload | 10 min discussion |

---

## 5. Open questions to settle with the team

1. Which dataset are you using, and does it have enough late invoices in the test period for a top-5-per-day backtest?
2. Do the organizers test on a hidden dataset?
3. Who owns the policy backtest?
4. What is the verified MyInvois revenue threshold and phase date?
