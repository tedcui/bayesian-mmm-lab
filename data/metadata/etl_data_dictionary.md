# M2B ETL data dictionary

The ETL reads the three `source_*.parquet` tables and two explicitly synthetic auxiliary tables listed in `source_manifest.json`. It does not read `ground_truth.json`. All 44 original transaction fields survive unchanged in the local `fact_transactions_enriched.parquet`; their definitions are in [the source contract](../../docs/SOURCE_SCHEMA_AND_ETL.md).

| Field | Grain / unit | Source and rule |
|---|---|---|
| `source_file_row_number` | transaction line, 1-based | Position in source Parquet row order; together with `FILE_SUBMISSION_ID` and `TRANSACTION_ID`, supports lineage. |
| `store_match`, `product_match`, `null_upc`, `join_fanout` | transaction line, boolean | LEFT reference join diagnostics. Null UPC never matches a null reference UPC. Duplicate candidate reference keys fail before joins. |
| `store_master_id`, `product_master_id` | transaction line, nullable submitted-to-master identities | Store lookup uses `(SUBMITTER_ID, STORE_ID)`; product lookup uses `(BRAND_ID, UPC14)`. |
| `segment_id` | transaction line / segment-week | Store `STANDARD_STATE`, falling back to `STATE`, mapped through the six-region geography crosswalk in the M2A source dictionary. |
| `week_start` | Monday calendar date | Monday of `TRANSACTION_DATE`, never `SUBMISSION_DATE_TIME`. |
| `is_eligible`, `exclusion_reasons` | transaction line | Simulation-only rule: matched references, known geography, positive whole quantity, positive price, valid event/submission times, active `STATUS=A`, non-test, no source errors/transformation, unique transaction ID, consistent promotion and nonoverlapping nonnegative discounts. Optional `as_of` snapshot excludes records submitted later than cutoff. All source lines remain in the enriched fact. These status meanings are **not** verified production definitions. |
| `quantity_units`, `sales_units` | line / segment-week, units | Validated source `QUANTITY`; sum of eligible lines only. A line is not a basket. |
| `observed_baskets` | segment-week, count | Distinct `MARKET_BASKET_TRANSACTION_ID` among eligible lines. |
| `unique_selling_stores` | segment-week, count | Stores with eligible recorded sales; a descriptive field, **not** the distribution control. |
| `observed_gross_sales_usd`, `observed_net_sales_usd` | segment-week, USD | Sum of `QUANTITY × PRICE` and gross minus observed discounts. PRICE means pre-discount USD per unit only in this simulation. |
| `redeemed_*_discount_usd`, `promo_line_rate` | segment-week | Receipt observations; descriptive mart only, never planned marketing spend or default model features. |
| `coupon_spend`, `retailer_promo_spend`, `digital_spend` | segment-week, planned USD | Pivot of `SIM_MARKETING_PLAN.planned_spend`; one plan per channel and cell, created before the sales week. |
| `price_index`, `distribution_index`, `competitor_index` | segment-week, unitless | `SIM_MARKET_CONTEXT.planned_price_index`, `availability_index`, and `competitor_index`, recorded before the sales week. |
| `holiday` | segment-week, binary | ISO calendar weeks 47–52. |
| `time_index`, `is_holdout` | segment-week | Weeks 1–120 per segment; weeks 101–120 are holdout. All weeks and spend history remain in `model_ready` for later adstock calculations. |

The model table contains exactly the 12 fields listed in `modeling/src/mmm_lab/etl/features.py`. No scaling is performed in M2B, so no fitted preprocessing parameters can leak holdout information. A missing eligible segment-week fails validation; zero fill requires explicit source coverage evidence, which the simulator does not provide. Future holdout comparisons using planned spend and context are conditional predictions, not unconditional forecasts.

`etl_quality.json` reports join coverage, exclusions, and source submissions. `etl_reconciliation.json` records eligible units, mart units, and planned spend totals; the pipeline also checks both quantities **for every segment-week**. `etl_manifest.json` captures source checksums, feature mapping, split, and output checksums. The large enriched fact is regenerated locally and ignored by Git; compact mart/model/report artifacts are retained.
