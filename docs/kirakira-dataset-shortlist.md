# KiraKira Dataset Shortlist

**Taylor's Hackathon · Track 1: Predictive Model Track**
Searched: Sat 10 Oct 2026, ~12:50 to 13:10 · Checked against the dataset checklist (paid date, due date, amount, repeating customer ID, size, late rate, real vs synthetic, leakage, licence)

---

## 1. Bottom line

- **Best option: the IBM "Late Payment Histories" sample (2,466 invoices).** I downloaded it and profiled it. It is clean and fully settled, and it has strong customer-history signal. **But IBM's own documentation describes it as simulated data, so your plan's claim of "real public invoices" is wrong for this dataset and must be reworded.**
- **Second option: the Kaggle "Payment Date Dataset" (50,000 rows, HighRadius-style schema).** Good for scale and for a train-on-A, test-on-B robustness check. **I could not download or profile it** (Kaggle needs a login), so its late rate, customer counts, date range, licence and provenance are all unverified. Someone on the team has to download it.
- **Nothing public and Malaysian turned up.** Everything else I found is aggregate-only, restricted, private, or not about payment timing.

---

## 2. Candidate scorecard

| Checklist item | IBM Late Payment Histories | Kaggle Payment Date Dataset |
|---|---|---|
| Paid/settled date | ✅ `SettledDate`, 0 nulls | ✅ `clear_date` (open invoices have none) |
| Due date | ✅ `DueDate`, 0 nulls | ✅ `due_in_date` |
| Invoice/issue date | ✅ `InvoiceDate` | ⚠️ no plain issue date; use `baseline_create_date`, `posting_date` or `document_create_date` |
| Amount | ✅ `InvoiceAmount` | ✅ `total_open_amount` |
| Repeating customer ID | ✅ 100 customers, 15 to 36 invoices each (median 24) | ✅ `cust_number` (distribution not checked) |
| Date range | ✅ Jan 2012 to Dec 2013 (24 months) | ❓ not verified |
| Size | ⚠️ 2,466 rows | ✅ 50,000 rows (one paper used only 12,071 after filtering) |
| Late rate | ✅ 35.6% | ❓ not verified |
| Late invoices in last 20% | ⚠️ 140 of 494 (28.3%); thinner than the "few hundred" I suggested | ❓ not verified |
| Open/unpaid invoices | ✅ none; all 2,466 are settled, so no censoring problem | ⚠️ has an `isopen` flag; the censoring rule in your plan applies |
| Real vs synthetic | ❌ **simulated** per its documentation | ❓ unclear (see section 4) |
| Dispute flag | ✅ `Disputed` (22.7% Yes) | ❌ none |
| Payment terms | ❌ all 30 days, no variation | ✅ `cust_payment_terms` |
| Licence | ❓ not confirmed (IBM Watson Analytics sample data) | ❓ not confirmed |
| Where | [Kaggle copy cited by a paper](https://www.kaggle.com/hhenry/finance-factoring-ibm-late-payment-histories); I used a [GitHub copy](https://github.com/bcBusinessStats/data1135) | [Kaggle](https://www.kaggle.com/datasets/pradumn203/payment-date-prediction-for-invoices-dataset) (a [second upload](https://www.kaggle.com/datasets/rajattomar132/payment-date-dataset) has the same description) |

---

## 3. IBM dataset: what I measured

Columns: `countryCode, customerID, PaperlessDate, invoiceNumber, InvoiceDate, DueDate, InvoiceAmount, Disputed, SettledDate, PaperlessBill, DaysToSettle, DaysLate`.

| Check | Result |
|---|---|
| Rows / customers | 2,466 invoices / 100 customers |
| Late rate (`settled > due`) | 35.6% |
| Last 20% by date (Jul to Dec 2013) | 494 rows, 140 late, 0 customers unseen in training |
| Late ringgit share in test slice | 29.4% of total value |
| Invoice amount | $5 to $128, mean about $60 |
| Missing values | none |
| Customer late share spread | 10th percentile 0%, median 25%, 90th percentile 88% (customers genuinely differ) |

**Quick signal and leakage check** (last 20% of dates; 0.5 means no signal):

| Feature | AUC alone |
|---|---|
| Customer's prior late share (counting only invoices **settled before** this invoice's issue date) | **0.851** |
| `Disputed` flag | 0.663 |
| `countryCode` | 0.563 |
| `PaperlessBill` | 0.540 |
| `InvoiceAmount` | 0.529 |

Late rate is 68% when `Disputed = Yes` versus 26% when `No`.

### Problems to plan around
1. **It is synthetic.** The [package documentation](https://rdrr.io/github/bcBusinessStats/data1135/man/accts_recv.html) calls it "simulated data from IBM Watson". Change the proof page, the pitch ("real public invoices") and the Q&A answer to "public simulated benchmark" before anyone says it on stage. The honest framing: it proves the method on a standard public benchmark, and the demo book is separately simulated and disclosed.
2. **`Disputed` may be leaking.** It is the strongest non-history feature, but if a dispute is only raised after the invoice is sent, it is not known at prediction time. Decide with the team, and report results with and without it.
3. **Amounts barely vary and terms are all 30 days.** Cash at risk (amount x probability) will rank almost the same as probability alone, so the "largest invoice first" baseline in your policy backtest will look weak. That weakens that comparison; say so rather than hiding it.
4. **Cold start cannot be tested on the time-split test slice** (every test invoice has plenty of history). To test cold start, deliberately restrict history to the first 0 to 2 invoices per customer, or use the customer hold-out split.
5. **The hold-out-customer split still needs `GroupKFold`**, because the time split has no unseen customers.
6. **Sample size.** 140 late invoices in the test slice is enough for AUC and precision, but thin for a fine-grained top-5-per-day policy backtest. Report coverage at several N values.

### What I did not check
Whether a model trained on it reaches a usable AUC. The 0.85 single-feature result is encouraging, but a full model has not been trained.

---

## 4. Kaggle Payment Date Dataset: what is known

From the [Baselight listing](https://baselight.app/u/kaggle/dataset/rajattomar132_payment_date_dataset) (that site has since shut down) and the [Kaggle page](https://www.kaggle.com/datasets/pradumn203/payment-date-prediction-for-invoices-dataset): 50,000 rows, 19 columns, 1.7 MB.

Columns: `business_code, cust_number, name_customer, clear_date, buisness_year, doc_id, posting_date, document_create_date, document_create_date_1, due_in_date, invoice_currency, document_type, posting_id, area_business, total_open_amount, baseline_create_date, cust_payment_terms, invoice_id, isopen`.

The description frames it as invoices with a payment date to predict and aging buckets. A GitHub project built on the same schema uses 2019 to 2020 date ranges and INR currency, and mentions HighRadius, so it appears to come from a HighRadius training exercise. **Whether the data is real or synthetic is not stated anywhere I could read.**

**Unverified, so someone must check after downloading:** late rate, customers and invoices per customer, date range, how many rows are open (`isopen = 1`), duplicate invoice IDs, missing values, and the licence.

**Mapping effort for `features.py`:** map `due_in_date`, `clear_date`, `total_open_amount`, `cust_number`, `cust_payment_terms`; pick one date column as the issue date; no dispute flag, so drop that feature from the shared model.

**Reference point:** a [2025 paper](https://arxiv.org/pdf/2511.03631) used a 12,071-invoice SME-style subset of this dataset and the IBM one, with a 7-day grace period, and reported balanced accuracy of about 0.62 to 0.70 on the Kaggle data versus 0.68 to 0.72 on IBM. Treat that as a hint that this dataset is harder, not as a target (different label, different models).

**Best use:** a second dataset for a train-on-IBM, test-on-this check (the "unfamiliar data" evidence), if the schema mapping fits your time budget. The paper capped each customer's history at 50 invoices, which is a reasonable thing to copy.

---

## 5. Found, but not usable here

| Source | What it is | Why it doesn't work |
|---|---|---|
| [Smart Data Foundry: SMB Invoices](https://data.sdruk.ukri.org/browser/dataset/88/0) | UK SME invoice microdata from a cloud accounting provider, Apr 2022 to Sep 2025, due date, amount, payment dates, status | Controlled access through a Trusted Research Environment, so not obtainable in 20 hours. A synthetic test version exists, but the access route is not a quick download. Worth mentioning as the "real version of this data exists" point |
| [UK Payment Practices Reports](https://check-payment-practices.service.gov.uk/report/59274/) | Company-level payment statistics (average days, % within 30 days) | Aggregates per company per half-year, no per-invoice rows |
| [Queensland government late payment datasets](https://data.qld.gov.au/dataset/late-payments-desbt) | Quarterly late-payment counts and interest | Aggregates only |
| [Coface Late Payment Index sample](https://datarade.ai/data-products/late-payment-index-sample-data-set-coface-business-information) | Payment index for 15 companies | Tiny and paid |
| [Appel et al. paper data](https://arxiv.org/pdf/1912.10828) (175,552 invoices, 3,725 customers) | Real Latin American invoice data | Private; only the paper is public |
| Bahrami et al. ([abstract](https://pubmed.ncbi.nlm.nih.gov/31976741/)) | 1.6 million customers' invoice and payment history | Private |
| [Customer Invoices (retail)](https://www.kaggle.com/datasets/bahauddinkalyani/customer-invoices) | Invoice-level view of the UK online retail data | No due or paid dates |
| [Customer Invoice Dataset (order amount)](https://www.kaggle.com/datasets/nikhil1479/customer-invoice-dataset) | Described as order-amount prediction on open invoices | Not framed around payment dates; I did not inspect its columns |
| [Invoice NER dataset](https://www.kaggle.com/datasets/nikitpatel/invoice-ner-dataset) | Invoice text for entity extraction | Wrong task |

Searches of UCI, Zenodo, Mendeley and Hugging Face turned up nothing usable with per-invoice payment dates.

---

## 6. Recommendation

1. **Train and evaluate on IBM first.** It is clean, uncensored and has real customer-history signal. Start the model today on it.
2. **Have one teammate download the Kaggle Payment Date dataset now** (Kaggle login needed) and run the checklist's 10-minute sanity check (invoices per customer, late rate, rows in the last 20%, missing values, `isopen` count, leakage). Use it as the second dataset only if the numbers look healthy.
3. **Fix the wording in the plan before it reaches slides:** replace "real public invoices" with "public simulated benchmark" for IBM, and confirm real versus synthetic for the Kaggle one before claiming anything.
4. **Resolve the `Disputed` question** and report the model with and without it.
5. **Keep the Malaysian story where it belongs:** the demo book and MyInvois are the local evidence; the public data only proves the method.
6. **Check licences** (IBM sample data, Kaggle uploads) and name them in the README. I could not confirm either.

---

## Sources

- [Kaggle: Customer Invoices Dataset (Payment Date Prediction)](https://www.kaggle.com/datasets/pradumn203/payment-date-prediction-for-invoices-dataset)
- [Baselight: Payment Date Dataset listing (site shut down)](https://baselight.app/u/kaggle/dataset/rajattomar132_payment_date_dataset)
- [R package docs: accts_recv (IBM Watson simulated data)](https://rdrr.io/github/bcBusinessStats/data1135/man/accts_recv.html)
- [GitHub: bcBusinessStats/data1135 (file I profiled)](https://github.com/bcBusinessStats/data1135)
- [arXiv 2511.03631: Financial Management System for SMEs](https://arxiv.org/pdf/2511.03631)
- [arXiv 1912.10828: Optimize Cash Collection](https://arxiv.org/pdf/1912.10828)
- [Smart Data Foundry SMB Invoices](https://data.sdruk.ukri.org/browser/dataset/88/0)
- [UK Check Payment Practices](https://check-payment-practices.service.gov.uk/report/59274/)
- [Queensland Open Data: Late payments](https://data.qld.gov.au/dataset/late-payments-desbt)
- [Datarade: Coface Late Payment Index sample](https://datarade.ai/data-products/late-payment-index-sample-data-set-coface-business-information)
- [PubMed: Using Behavioral Analytics to Predict Customer Invoice Payment](https://pubmed.ncbi.nlm.nih.gov/31976741/)
