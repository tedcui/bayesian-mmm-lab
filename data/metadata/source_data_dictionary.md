# M2A synthetic source data dictionary

The three `data/silver/source_*.parquet` tables use the exact field inventories,
types, and nullability in [SOURCE_SCHEMA_AND_ETL.md](../../docs/SOURCE_SCHEMA_AND_ETL.md).
The `SOURCE_*` names are generic portfolio aliases.
That document is the field-by-field dictionary for all 44 transaction, 42 store,
and 19 brand fields. The generator reads its inventories, and the validator checks
the resulting Arrow schemas. The two auxiliary tables below are **additional
synthetic sources**, not fields in the supplied silver tables.

## Grain, keys, and units

| File | Grain and key | Default rows |
|---|---|---:|
| `silver/source_transactions.parquet` | Transaction detail; unique `TRANSACTION_ID` | 171,741 |
| `silver/source_stores.parquet` | Submitted store; (`SUBMITTER_ID`, `STORE_ID`) | 190 |
| `silver/source_brands.parquet` | Submitted item; (`BRAND_ID`, `UPC14`) | 36 |
| `auxiliary/sim_marketing_plan.parquet` | (`segment_id`, `week_start`, `channel`) | 2,160 |
| `auxiliary/sim_market_context.parquet` | (`segment_id`, `week_start`) | 720 |

`TRANSACTION_ID`, `STORE_ID`, `BRAND_ID`, basket IDs, and campaign IDs are
deterministic uppercase 32-character hexadecimal strings. `SUBMITTER_ID` is an
invented 36-character UUID string. `UPC14` is a 14-character text value with
leading zeros. Submitted, master, and legacy identifiers represent separate
identity levels. Multiple submitted identities intentionally share some master
IDs, but candidate lookup keys remain unique. This is a current-state mapping,
with no historical versioning.

`QUANTITY` and `ORIGINAL_QUANTITY` are whole units stored as three-place
decimals; one detail row can contain multiple units and one basket can have
multiple lines. `PRICE` means **pre-discount USD per unit in this simulation**.
The supplied source's production meaning is unverified. The simulated net
amount for a line would be `QUANTITY * PRICE` less its one selected discount.
The coupon, account, and manufacturer discount fields are mutually exclusive;
they are receipt-level redemptions, not planned channel budgets. `PROMOTION_FLAG`
means that one of these discount fields is present. `STATUS = A`,
`TEST_DATA = false`, and zero error counts mean valid active synthetic records
only; these are not real source-system code definitions. Other optional fields
remain null when no plausible synthetic value exists, including source
`AVG_PRICE` and `THIRTEEN_WK_QUANTITY`, whose as-of timing is unknown.

`TRANSACTION_DATE` and `TRANSACTION_DATE_TIME` are timezone-naive business event
times; `SUBMISSION_DATE_TIME`, `CREATED`, and `MODIFIED` are UTC timestamps.
Submissions occur one to three days plus up to 11 hours after the event,
possibly in the next week.
Weekly grouping must eventually use the event date. Store names, addresses,
phones, email domains (`example.invalid`), loyalty IDs, and product names are
invented. No real customer information is present.

## Business geography

`segment_id` is a fixed business region from `STORES.STANDARD_STATE`, falling
back to `STORES.STATE` when the standardized field is null (20 default stores).
It is not a learned cluster. Mapping:

| Segment | States | Stores |
|---|---|---:|
| `northeast` | NY, MA, PA | 50 |
| `southeast` | FL, GA, NC | 40 |
| `great_lakes` | IL, OH, MI | 35 |
| `south_central` | TX, OK, LA | 30 |
| `mountain_west` | CO, UT, NM | 20 |
| `pacific_coast` | CA, OR, WA | 15 |

## Separate auxiliary fields

| Field | Meaning / units |
|---|---|
| `segment_id` | One of the six named geographic regions above |
| `week_start` | Monday business-week start, date |
| `channel` | `coupon`, `retailer_promotion`, or `digital` |
| `planned_spend` | Planned USD budget, generated before demand |
| `min_spend`, `max_spend` | Synthetic allowed weekly USD bounds |
| `campaign_id` | Invented campaign ID, distinct from receipt IDs |
| `plan_created_at` | UTC timestamp 21 days before the week |
| `planned_price_index` | Ex-ante relative price context; 1 is neutral |
| `competitor_index` | Simulated external competitive pressure; 1 is neutral |
| `availability_index` | Ex-ante assortment/availability index, about 0.75–1 |
| `market_size_index` | Fixed at 1 in M2A; a reserved exposure control |
| `context_as_of` | UTC timestamp 14 days before the week |

Marketing spend has a shared campaign shock across channels, so campaigns
overlap and spend is correlated. Receipt discount frequency depends partly on
the plan, but receipt discounts are sampled **after** demand and cannot serve as
planned spend. `planned_price_index` is an ex-ante modeled control, not realized
average receipt price. Availability is simulated separately, not inferred from
observed selling-store activity.

## Generation and truth

The fixed default seed is `20261113`. The 120 weeks start Monday 2023-01-02.
Reference tables and pre-outcome plans/context are generated first. Per
segment/week, latent expected demand is an additive sum of a heterogeneous
baseline, price/availability/competitor controls, trend, annual Fourier
seasonality, holiday effect, and three channel responses. Each channel uses
geometric adstock `a_t = spend_t + decay * a_(t-1)` and a half-saturation
response `max_effect * a_t / (a_t + half_saturation)`. Segment-specific Gaussian
noise is added; sales are rounded to a nonnegative integer. Realized units are
then allocated to stores, products, baskets, and lines. The default source
quantities sum to 601,108 units and exactly reconstruct every latent
segment-week target.

`data/metadata/ground_truth.json` contains generating parameters, true
components, noise, rounding adjustment, and the target for **evaluation only**.
No ground-truth values are source fields or modeling features. `source_manifest.json`
records config, schema hash, causal ordering, file row counts, SHA256 hashes,
and simulation semantics. `source_quality.json` records source checks.

## Limits and leakage

The data are clean synthetic records with known stable equations and complete
source coverage. Real observational data can have changing targeting,
unmeasured demand shocks, missing stores, source revisions, identity history,
late ingestion, and selection effects. Correlated campaigns and price still
make individual channel effects hard to identify. The simulated source tables
are operational inputs; M2A deliberately creates no model-ready table. M2B
must join and aggregate from these sources and preserve event-time and
plan-as-of rules. `ground_truth.json`, realized receipt discounts, and
post-outcome selling-store counts must not become default model predictors.
