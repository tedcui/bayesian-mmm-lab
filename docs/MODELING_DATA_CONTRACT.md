# Modeling Data Contract — From Retail Source to Bayesian MMM

## Purpose

The modeled segment-week panel must be a **downstream data product**, not a standalone randomly generated CSV. It is built from the simulated three-table retail source and separately identified synthetic external marketing/context sources.

Read `SOURCE_SCHEMA_AND_ETL.md` for all source column names, datatypes and join caveats. The user's source description **did not specify an MMM mart, campaign-budget table, response function, price/revenue semantics, or marketing optimization policy**. This document proposes those additions for the portfolio app.

## Business question and model grain

> For each business-defined retail market segment, how do time, pricing, market conditions and planned marketing investment relate to weekly unit demand, and how do promotional responses differ across markets?

**Default model grain:** `segment_id × week_start`, 6 geographic market segments × 120 weekly periods = **720 rows** (provided the complete calendar has validated observations). The market segment is defined by the store's geographic attributes, not by an unsupervised clustering algorithm. One row is **not** a transaction, basket, store, or product.

**Target:** `sales_units` = sum of eligible transaction-detail `QUANTITY` by segment-week. For the initial model, aggregate across all simulated submitted product/items. Later option: `segment × MASTER_BRAND_ID × week` with a separate, documented modeling redesign and more data.

## Source-to-mart map

| Final analytical field | Physical source / derivation | Notes / timing |
|---|---|---|
| `segment_id` | Store `STANDARD_STATE` / fallback documented `STATE` → market mapping | Business-defined geography; no K-means |
| `week_start` | Transaction `TRANSACTION_DATE` (event time) → Monday week | Not `SUBMISSION_DATE_TIME` |
| `sales_units` | `SUM(QUANTITY)` after eligibility/QA | Outcome, never predictor at same future time |
| `observed_gross_sales` | `SUM(QUANTITY * PRICE)` | **Simulation-only** price-is-pre-discount assumption |
| `observed_net_sales` | Simulation-specific audited discount calculation | Descriptive only, do not double count fields |
| `weighted_realized_unit_price` | `SUM(QUANTITY * PRICE)/SUM(QUANTITY)` | Post-outcome descriptor; not default causal control |
| `promo_line_rate` | Promo-flagged eligible detail lines / eligible detail lines | Descriptive, not marketing budget |
| `redeemed_coupon_discount` | Sum of `PID_COUPON_DISCOUNT` subject to documented unit logic | Realized redeemed discount; outcome-dependent |
| `redeemed_mfg_discount` | Documented selected manufacturer discount fields | Beware overlapping definitions |
| `unique_selling_stores` | Distinct submitted/master stores with sales | NOT true active distribution or availability |
| `coupon_spend` | `SIM_MARKETING_PLAN` planned spend, channel coupon | Independent input, available before outcome |
| `retailer_promo_spend` | `SIM_MARKETING_PLAN` planned retailer promotion spend | Independent input |
| `digital_spend` | `SIM_MARKETING_PLAN` planned digital spend | Not present in 3 user source tables |
| `price_index` | `SIM_MARKET_CONTEXT.planned_price_index` | Pre-outcome planned pricing; not realized weighted sales price |
| `distribution_index` | `SIM_MARKET_CONTEXT.availability_index` | Exogenous simulated supply/availability, not unique selling stores |
| `competitor_index` | `SIM_MARKET_CONTEXT.competitor_index` | Exogenous synthetic control |
| `holiday` | Deterministic calendar | Known in advance |
| `trend` | Sequential week index | Known in advance |
| `quality_*` | Join/eligibility/report metrics | ETL provenance, not indiscriminately predictive |

Do not merge coupon and promotion *redemption* amounts as campaign *spend* without an explicit campaign budget/expense accounting specification. Spend is an input (policy/intervention); redemption is a post-exposure measurement that can be determined by how much consumers bought.

## Synthetic generating process and consistency

1. Generate stores, products, submitter mappings and geography groups, keeping raw and standardized identity attributes separate.
2. Generate pre-outcome `SIM_MARKETING_PLAN` and `SIM_MARKET_CONTEXT` for each week and segment. Preserve correlation among promotions, competitor pressure and market baselines to create realistic modeling problems.
3. Use a known synthetic model, for instance an additive expected-units model with positive promotional response and controls:

\[
\mu_{g,t}= B_{g,t}(X_{g,t}) + \sum_{k=1}^3 \beta_{g,k}\,s_k(a_k(Spend_{g,k,1:t}))
\]

where `a` is an adstock transformation and `s` is a nonlinear saturation function. Constrain or otherwise check positive expected demand; choose an integer-valued outcome-generation distribution and document any rounding and heteroskedasticity.

4. Draw realized weekly unit totals; allocate them to simulated stores/products, then baskets, then detail rows whose summed eligible `QUANTITY` is **exactly** the drawn realized count. Do not independently draw transaction lines and an unrelated panel target.
5. Create receipt-level promotions and discounts consistent with campaign periods, **without requiring redeemed discount totals to equal planned budget**. Generate simulated submission timestamps after event times, with optional controlled late-arrival fixtures.
6. Run ETL and prove that eligible-source units reaggregate to each generated weekly target. Store known baseline, contribution, true coefficients, adstock/saturation, and noise in **`data/metadata/ground_truth.json` only**.

The simpler example above is a suggested modeling design, **not a specified source rule**. Validate the final model against the actual chosen generator.

## Downstream artifacts

```text
data/silver/source_transactions.parquet
data/silver/source_stores.parquet
data/silver/source_brands.parquet
data/auxiliary/sim_marketing_plan.parquet
data/auxiliary/sim_market_context.parquet
            |
            v
data/marts/fact_transactions_enriched.parquet
            |
            v
data/marts/mart_segment_week.parquet
            |
            v
data/processed/model_ready.parquet
            |
            v
notebooks/01_data_exploration.ipynb
            |
            v
notebooks/02_bayesian_hierarchical_mmm.ipynb
            |
            v
notebooks/03_model_evaluation.ipynb
```

The ETL should store a lineage manifest (hashes of source files and rules, generator seed, ETL version, output checksums) plus a human-readable reconciliation/quality report. `model_ready` should contain only legitimate predictors, target, key, and metadata; source-generated truth belongs in a separate validation artifact.

### Recommended 720-row model-ready fields

```text
segment_id, week_start, time_index, is_holdout,
sales_units,
price_index, distribution_index, competitor_index, holiday,
coupon_spend, retailer_promo_spend, digital_spend
```

Optional separate descriptive mart fields: `observed_gross_sales`, `observed_net_sales`, `promo_line_rate`, `redeemed_coupon_discount`, `redeemed_mfg_discount`, `unique_selling_stores`, `eligible_transaction_lines`, `unmatched_store_lines`, `unmatched_product_lines`, `source_submission_count`. Keep these out of `model_ready` by default to reduce accidental leakage.

### Data time split and history

- Train: weeks 1–100. Holdout: weeks 101–120.
- Determine the Monday calendar consistently with source transaction event date.
- Use history from weeks prior to the forecast horizon for adstock state.
- Learn normalizers/scalers only on training data.
- Planned promotion and competitor context may be modeled as *known future scenarios*. If actual future channel spends are used for holdout comparison, call the output **conditional holdout prediction**, not an unconditional future-demand forecast.
- For historical-source corrections/late-arrival evaluation, define an as-of snapshot. A transaction recorded after cutoff should not appear in a historically frozen as-of dataset.

## Hierarchical MMM specification and evaluation

Fit three models on the ETL-produced mart, with consistent covariates/transformations:

1. **Full pooling:** one response coefficient per channel shared across six segments.
2. **No pooling:** independent response coefficients per segment/channel.
3. **Partial pooling:** response coefficient per segment/channel with shared hierarchical hyperparameters.

Partial pooling estimates stable effects for weak-information segments by borrowing information from others. Simulate weak promotional signal via limited campaign variation and noise rather than just arbitrary labels. Where generating truth and likelihood differ, explain consequences for recovery.

Use PyMC-Marketing only if the pinned API transparently supports this hierarchical structure; lower-level PyMC is acceptable and may be simpler for exact control over the model. All results must be computed from actual posterior fits, not a synthetic stand-in.

Evaluation includes R-hat, ESS, divergences, prior predictive checks, posterior predictive checks, segment-level parameter recovery and intervals, time holdout MAE/WAPE/bias, predictive coverage, and sensitivity to correlated campaign schedules. Compare segment estimates to true generated effects; partial pooling can shrink too much or be biased when segments differ strongly.

## The model may not automatically establish incrementality

Observed promotional spending is commonly targeted: it may rise where demand is already expected to rise. A Bayesian decomposition can fit demand well even when effects are confounded. In the app, label outputs **modeled promotional contributions** or **scenario effects under assumptions**. Do not report experiment-validated lift, causal ROAS, or incremental profit absent credible external causal identification and clearly documented units.

## Simulator contract

- Scenario input = **planned spend** by channel and market over 12 weeks, never the transaction's redeemed discounts.
- Keep planned price/competitor/availability/other context fixed between baseline and comparison unless explicitly changed in another scenario mode.
- Recompute exact fitted adstock and saturation with pre-scenario spend history **per posterior draw**.
- Compare scenario and baseline with the **same joint posterior draw**, and summarize distribution of differences.
- Baseline scenario → exactly zero modeled change within floating-point tolerance.
- Warn on unsupported marketing spend extrapolation and missing data.
- Budget optimizer initially optimizes expected modeled sales subject to budget and channel caps; **not ROI** unless value/margin/costs are added and validated.
- Python scenario implementation is the reference; TypeScript parity fixtures must agree numerically.

## Data QA gate before M3

- No duplicate `(segment_id, week_start)` rows in the mart.
- No row explosion from either store or product joins.
- Source-to-mart sales-unit reconciliation by segment and week.
- `SIM_MARKETING_PLAN` sums exactly match planned spend fields in mart.
- All expected weeks are accounted for; no silent zero filling of ingestion gaps.
- `ground_truth.json` is not imported by feature/model-fitting functions.
- Each modeling feature has source lineage and known temporal availability.
- No undefined discount/revenue or source-code semantics passed off as facts.
- If a source-data quality fixture fails by design, it is quarantined/tested rather than silently allowed into training.
