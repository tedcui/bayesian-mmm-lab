# Source Schema & ETL Contract — Synthetic Silver Layer

**Provenance.** This document adapts the user-supplied **ETL Source Model: Transactions, Stores, and Brands**. `SYNTHETIC_SOURCE` and all `SOURCE_*` table names are generic aliases for this portfolio. The source column inventories, candidate grains, and join keys are adapted from the supplied description. The recommended 32-character uppercase hex ID convention is a target/ETL representation, not a verified claim about physical source storage. The source supplied **no verified database key/foreign-key constraints, status-code definitions, pricing semantics, or downstream MMM specifications**. Every added simulation convention is labeled as such.

Do not publish real internal extracts. All rows, store names, UPCs, submitter IDs, contact fields, and dates in this portfolio must be invented. This schema description itself may contain organization-specific metadata: review/anonymize for public repository use.

## Operational source tables and intended grains

| Table | Grain | Interpretation |
|---|---|---|
| `SYNTHETIC_SOURCE.SOURCE_TRANSACTIONS` | One submitted transaction **detail** record, not a whole basket | Fact-like sales events, promotion/discount attributes and lineage |
| `SYNTHETIC_SOURCE.SOURCE_STORES` | One submitted store reference | Store/address, optional master-store crosswalk and lineage |
| `SYNTHETIC_SOURCE.SOURCE_BRANDS` | One submitted **product/item** reference, not just a brand name | UPC/item, optional master-product crosswalk and lineage |

### Observed join predicates

```sql
-- Transaction detail -> submitted store
LEFT JOIN SOURCE_STORES s
  ON t.SUBMITTER_ID = s.SUBMITTER_ID
 AND t.STORE_ID = s.STORE_ID

-- Transaction detail -> submitted item/product
LEFT JOIN SOURCE_BRANDS b
  ON t.BRAND_ID = b.BRAND_ID
 AND t.UPC14 = b.UPC14
```

**Important:** These are the observed sample-SQL joins, not guaranteed PK/FK constraints. `(SUBMITTER_ID, STORE_ID)` and `(BRAND_ID, UPC14)` must have at most one matching reference record per transaction to avoid fanout. `UPC14` can be null; ordinary SQL null equality does not match null to null. Product join does not include `SUBMITTER_ID` in the observed sample; adding it requires an explicit separate rule. There is **no direct store-to-product relationship** outside transaction detail.

Preserve `STORE_ID`, `MASTER_STORE_ID`, `LEGACY_OUTLET_ID` and `BRAND_ID`, `MASTER_BRAND_ID`, `LEGACY_ITEM_ID` as different identity levels. Preserve original and standardized addresses separately. `FILE_SUBMISSION_ID` is lineage, not a store-product link.

## Exact source-aligned column inventories

The following inventories reproduce the column names, recommended ETL data types, and source nullability from the supplied description. They are used as a schema-checking contract for the synthetic generator.

### SOURCE_TRANSACTIONS — 44 columns

| Column | Documented ETL type | Nullable | Source meaning / caution |
|---|---|---|---|
| `TRANSACTION_ID` | `VARCHAR2(32 CHAR)` | No | Candidate transaction-detail identifier. Validate uniqueness before using as a merge key. |
| `FILE_SUBMISSION_ID` | `NUMBER(19,0)` | No | Identifier of the associated file submission. |
| `SUBMITTER_ID` | `VARCHAR2(36 CHAR)` | Yes | Submitted organization/source identifier. |
| `BRAND_ID` | `VARCHAR2(32 CHAR)` | No | Reference to the submitted product/item record. |
| `STORE_ID` | `VARCHAR2(32 CHAR)` | No | Reference to the submitted store record. |
| `CREATED` | `TIMESTAMP(7) WITH TIME ZONE` | Yes | Source creation timestamp; default is `CURRENT_TIMESTAMP`. |
| `MODIFIED` | `TIMESTAMP(7) WITH TIME ZONE` | Yes | Source modification timestamp. Its update behavior needs confirmation. |
| `SUBMISSION_DATE_TIME` | `TIMESTAMP(7) WITH TIME ZONE` | Yes | Timestamp associated with submission. |
| `TRANSACTION_DATE` | `TIMESTAMP(7)` | No | Business transaction date field. Do not assume all time components are midnight without validation. |
| `TRANSACTION_DATE_TIME` | `TIMESTAMP(7)` | Yes | Detailed transaction timestamp without an embedded time zone. |
| `MARKET_BASKET_TRANSACTION_ID` | `VARCHAR2(100 CHAR)` | Yes | Submitted basket identifier; uniqueness scope needs confirmation. |
| `MARKET_BASKET_KEY` | `VARCHAR2(32 CHAR)` | Yes | Additional basket key; relationship to the submitted basket identifier needs confirmation. |
| `SCAN_TRANSACTION_ID` | `VARCHAR2(60 CHAR)` | Yes | Submitted scan identifier; do not assume global uniqueness. |
| `REGISTER_ID` | `VARCHAR2(50 CHAR)` | Yes | Submitted register identifier. |
| `STORE_NUMBER` | `VARCHAR2(50 CHAR)` | Yes | Submitted store number retained on the transaction. |
| `ACCOUNT_LOYALTY_ID_NUMBER` | `VARCHAR2(100 CHAR)` | Yes | Loyalty/account identifier. Preserve as text and retain submitter context. |
| `UPC14` | `VARCHAR2(14 CHAR)` | Yes | Transaction product barcode representation. Preserve leading zeros. |
| `QUANTITY` | `NUMBER(15,3)` | Yes | Recorded quantity. |
| `PRICE` | `NUMBER(15,3)` | Yes | Recorded price; unit-versus-line semantics require confirmation. |
| `ORIGINAL_QUANTITY` | `NUMBER(15,3)` | Yes | Original quantity retained alongside the current quantity. |
| `ORIGINAL_UPC14` | `VARCHAR2(14 CHAR)` | Yes | Original barcode retained alongside the current barcode. |
| `TRANSFORMATION_FLAG` | `VARCHAR2(1 CHAR)` | Yes | Transformation indicator; obtain its code dictionary. |
| `TRANSFORMATION_2_PASS_FLAG` | `VARCHAR2(1 CHAR)` | Yes | Additional transformation-stage indicator; obtain its code dictionary. |
| `PROMOTION_FLAG` | `BOOLEAN` | No | Promotion indicator. |
| `OUTLET_MULTIPACK_FLAG` | `BOOLEAN` | No | Outlet multipack indicator. |
| `OUTLET_MULTIPACK_QUANTITY` | `NUMBER(18,3)` | Yes | Outlet multipack quantity attribute. |
| `OUTLET_MULTIPACK_DISCOUNT_AMOUNT` | `NUMBER(15,3)` | Yes | Outlet multipack discount amount. |
| `ACCOUNT_PROMOTION_NAME` | `VARCHAR2(250 CHAR)` | Yes | Submitted account promotion name. |
| `ACCOUNT_DISCOUNT_AMOUNT` | `NUMBER(15,3)` | Yes | Account discount amount. |
| `MFG_DISCOUNT_AMOUNT` | `NUMBER(15,3)` | Yes | Manufacturer discount amount. |
| `PID_COUPON` | `VARCHAR2(100 CHAR)` | Yes | Submitted coupon/PID value; exact business meaning needs confirmation. |
| `PID_COUPON_DISCOUNT` | `NUMBER(15,3)` | Yes | Discount associated with the coupon/PID field. |
| `MANUFACTURER_MULTIPACK_FLAG` | `BOOLEAN` | No | Manufacturer multipack indicator. |
| `MANUFACTURER_MULTIPACK_QUANTITY` | `NUMBER(15,3)` | Yes | Manufacturer multipack quantity attribute. |
| `MANUFACTURER_MULTIPACK_AMOUNT` | `NUMBER(15,3)` | Yes | Manufacturer multipack amount. |
| `MANUFACTURER_PROMOTION_DESCRIPTION` | `VARCHAR2(250 CHAR)` | Yes | Manufacturer promotion description. |
| `MANUFACTURER_BUYDOWN_DESCRIPTION` | `VARCHAR2(250 CHAR)` | Yes | Manufacturer buydown description. |
| `MANUFACTURER_BUYDOWN_AMOUNT` | `NUMBER(15,3)` | Yes | Manufacturer buydown amount. |
| `MANUFACTURER_MULTIPACK_DESCRIPTION` | `VARCHAR2(250 CHAR)` | Yes | Manufacturer multipack description. |
| `COUPON_DESCRIPTION` | `VARCHAR2(250 CHAR)` | Yes | Coupon description. |
| `TEST_DATA` | `BOOLEAN` | Yes | Test-data indicator. Null handling requires an explicit rule. |
| `ERROR_COUNT` | `NUMBER(10,0)` | Yes | Source error-count field. |
| `DISPLAY_ERROR_COUNT` | `NUMBER(10,0)` | Yes | Source display-error-count field. |
| `STATUS` | `VARCHAR2(1 CHAR)` | Yes | Source status code; meanings are not supplied. |

### SOURCE_STORES — 42 columns

| Column | Documented ETL type | Nullable | Source meaning / caution |
|---|---|---|---|
| `STORE_ID` | `VARCHAR2(32 CHAR)` | No | Candidate submitted-store identifier. |
| `SUBMITTER_ID` | `VARCHAR2(36 CHAR)` | Yes | Source organization associated with the store record. |
| `STORE_NUMBER` | `VARCHAR2(50 CHAR)` | Yes | Submitted store number; preserve formatting and leading zeros. |
| `MASTER_STORE_ID` | `NUMBER(19,0)` | Yes | Mapping to a master-store identity. |
| `GSS_ID` | `NUMBER(19,0)` | Yes | Additional store identifier; scope and meaning require documentation. |
| `OUTLET_LOCATION_ID` | `VARCHAR2(32 CHAR)` | Yes | Additional location identifier; uniqueness scope requires confirmation. |
| `LEGACY_OUTLET_ID` | `VARCHAR2(64 CHAR)` | Yes | Crosswalk to a legacy outlet identity. |
| `NAME` | `VARCHAR2(100 CHAR)` | Yes | Submitted store name. |
| `ADDRESS_LINE_1` | `VARCHAR2(100 CHAR)` | Yes | Submitted address line 1. |
| `ADDRESS_LINE_2` | `VARCHAR2(100 CHAR)` | Yes | Submitted address line 2. |
| `CITY` | `VARCHAR2(50 CHAR)` | Yes | Submitted city. |
| `STATE` | `VARCHAR2(2 CHAR)` | Yes | Submitted state code. |
| `ZIP` | `VARCHAR2(10 CHAR)` | Yes | Submitted postal code. |
| `CONTACT_NAME` | `VARCHAR2(50 CHAR)` | Yes | Store contact name. |
| `EMAIL_ADDRESS` | `VARCHAR2(50 CHAR)` | Yes | Store email address. |
| `PHONE_NUMBER` | `VARCHAR2(15 CHAR)` | Yes | Store phone number. |
| `FAX_NUMBER` | `VARCHAR2(15 CHAR)` | Yes | Store fax number. |
| `STANDARD_ADDRESS_LINE_1` | `VARCHAR2(100 CHAR)` | Yes | Standardized address line 1. |
| `STANDARD_ADDRESS_LINE_2` | `VARCHAR2(100 CHAR)` | Yes | Standardized address line 2. |
| `STANDARD_CITY` | `VARCHAR2(50 CHAR)` | Yes | Standardized city. |
| `STANDARD_HOUSE_NUMBER` | `VARCHAR2(10 CHAR)` | Yes | Standardized house number. |
| `STANDARD_PO_BOX` | `VARCHAR2(10 CHAR)` | Yes | Standardized PO box. |
| `STANDARD_RURAL_ROUTE_NUMBER` | `VARCHAR2(5 CHAR)` | Yes | Standardized rural route number. |
| `STANDARD_STATE` | `VARCHAR2(2 CHAR)` | Yes | Standardized state code. |
| `STANDARD_STREET_DIRECTION` | `VARCHAR2(2 CHAR)` | Yes | Standardized street direction. |
| `STANDARD_STREET_NAME` | `VARCHAR2(45 CHAR)` | Yes | Standardized street name. |
| `STANDARD_STREET_TYPE` | `VARCHAR2(6 CHAR)` | Yes | Standardized street type. |
| `STANDARD_ZIP` | `VARCHAR2(9 CHAR)` | Yes | Standardized postal code. |
| `LATITUDE` | `BINARY_DOUBLE` | Yes | Latitude value; coordinate reference system and sentinel values need confirmation. |
| `LONGITUDE` | `BINARY_DOUBLE` | Yes | Longitude value; coordinate reference system and sentinel values need confirmation. |
| `STANDARDIZED_INDICATOR` | `VARCHAR2(1 CHAR)` | Yes | Standardization code; obtain its value dictionary. |
| `VERIFICATION_INDICATOR` | `VARCHAR2(1 CHAR)` | Yes | Verification code; obtain its value dictionary. |
| `FILE_TYPE` | `VARCHAR2(6 CHAR)` | Yes | Source file-type code. |
| `OUTLET_TYPE` | `VARCHAR2(1 CHAR)` | Yes | Outlet classification code. |
| `FUEL_OUTLET_FLAG` | `VARCHAR2(20 CHAR)` | Yes | Fuel-outlet attribute; retain as text until values are documented. |
| `FILE_SUBMISSION_ID` | `NUMBER(19,0)` | No | Associated file submission. |
| `CREATED` | `TIMESTAMP(7) WITH TIME ZONE` | Yes | Source creation timestamp; default is `CURRENT_TIMESTAMP`. |
| `MODIFIED` | `TIMESTAMP(7) WITH TIME ZONE` | Yes | Source modification timestamp. |
| `TEST_DATA` | `BOOLEAN` | Yes | Test-data indicator. |
| `ERROR_COUNT` | `NUMBER(10,0)` | Yes | Source error count. |
| `DISPLAY_ERROR_COUNT` | `NUMBER(10,0)` | Yes | Source display-error count. |
| `STATUS` | `VARCHAR2(1 CHAR)` | Yes | Source status code. |

### SOURCE_BRANDS — 19 columns

| Column | Documented ETL type | Nullable | Source meaning / caution |
|---|---|---|---|
| `BRAND_ID` | `VARCHAR2(32 CHAR)` | No | Candidate submitted-product identifier. |
| `GBS_ID` | `NUMBER(19,0)` | Yes | Additional product identifier; scope and meaning need documentation. |
| `MASTER_BRAND_ID` | `NUMBER(19,0)` | Yes | Mapping to a standardized master-product identity. |
| `VERIFICATION_INDICATOR` | `VARCHAR2(1 CHAR)` | Yes | Verification code; obtain its value dictionary. |
| `LEGACY_ITEM_ID` | `VARCHAR2(64 CHAR)` | Yes | Crosswalk to a legacy item identity. |
| `DESCRIPTION` | `VARCHAR2(200 CHAR)` | Yes | Submitted product/item description. |
| `TEST_DATA` | `BOOLEAN` | Yes | Test-data indicator. |
| `UPC` | `VARCHAR2(50 CHAR)` | Yes | Submitted UPC value. |
| `UPC14` | `VARCHAR2(14 CHAR)` | Yes | Standardized barcode representation. |
| `CREATED` | `TIMESTAMP(7) WITH TIME ZONE` | Yes | Source creation timestamp; default is `CURRENT_TIMESTAMP`. |
| `MODIFIED` | `TIMESTAMP(7) WITH TIME ZONE` | Yes | Source modification timestamp. |
| `UNIT_OF_MEASURE` | `VARCHAR2(50 CHAR)` | Yes | Submitted unit-of-measure value. |
| `SUBMITTER_ID` | `VARCHAR2(36 CHAR)` | Yes | Source organization associated with the product record. |
| `FILE_SUBMISSION_ID` | `NUMBER(19,0)` | No | Associated file submission. |
| `AVG_PRICE` | `NUMBER(15,3)` | Yes | Existing source-provided summary attribute; definition and refresh timing need documentation. |
| `ERROR_COUNT` | `NUMBER(10,0)` | Yes | Source error count. |
| `DISPLAY_ERROR_COUNT` | `NUMBER(10,0)` | Yes | Source display-error count. |
| `THIRTEEN_WK_QUANTITY` | `NUMBER(15,3)` | Yes | Existing source-provided summary attribute; period anchor and refresh timing need documentation. |
| `STATUS` | `VARCHAR2(1 CHAR)` | Yes | Source status code. |

## Simulation conventions (not claims about the source)

- **Identifiers:** Generate deterministic uppercase 32-character hex strings for identifiers documented as `VARCHAR2(32 CHAR)`; keep `SUBMITTER_ID` at its documented max 36-character representation. Keep UPC-14 as exactly 14 text characters with leading zeros. Handle `NUMBER(19,0)` exactly using integer or text (text when crossing into JS/JSON).
- **Timestamps:** `TRANSACTION_DATE`/`TRANSACTION_DATE_TIME` are business event timestamps without time zone; `CREATED`/`MODIFIED`/`SUBMISSION_DATE_TIME` are source timestamps with time zone. Add ETL-only `ingested_at` and `source_file_row_number` outside the source-aligned schema.
- **Price:** `PRICE` has *unverified* physical semantics in the supplied document. For the simulation ONLY, define it as a pre-discount per-unit price. State this prominently in the generator metadata; derive net revenue from a documented non-double-counting discount mechanism, rather than treating every discount field as additive without checking.
- **Quantities:** Set `QUANTITY` and `ORIGINAL_QUANTITY` explicitly. One detail row may carry multiple units; one basket may contain multiple details. Revenue/units should reconcile to valid detail rows.
- **Promotion:** Generate `PROMOTION_FLAG` and selected discount/description fields to resemble recorded promotion/redemption activity, but do NOT use these as a substitute for independently planned marketing spend. Document synthetic flag and status codes; never imply these are source-production code dictionaries.
- **Reference mappings:** Some submitted stores/products can map to the same `MASTER_STORE_ID`/`MASTER_BRAND_ID`. Do not let this generate lookup duplicates at the documented submitted-identity grain. Limit the first release to a documented current-state mapping assumption; do not invent historical slowly changing dimensions without explicit design.
- **Synthetic contacts:** Use invented names, reserved/example domains, and fictional telephone values; no real loyalty identifiers, personal identities, or physical customer records.
- **Data-quality fixtures:** Main dataset should have realistic but well understood missing optional fields. Create a separate controlled anomaly fixture for unmatched references, duplicate candidate keys, late submissions, and ambiguous joins, so the main model isn't silently corrupted.
- **Scale:** Default local simulation: 6 geographic segments × 120 weeks, roughly 120–300 stores, 24–60 submitted product references, and a configurable approximately 100k–250k transaction-detail records. These are engineering defaults for a laptop, **not production counts**.

## Clearly additional auxiliary synthetic sources

The user's three source tables do **not** provide all variables needed for the old standalone M2 specification. In particular:

1. Discounts and `PROMOTION_FLAG` are realized activity/redemptions, not independent budget allocations.
2. No digital advertising spend or exposure field is defined in the three source tables.
3. No explicit competitor index or measured assortment/availability feed is provided.
4. `AVG_PRICE` and `THIRTEEN_WK_QUANTITY` are source-provided summary fields with **unspecified as-of timing**; they must not enter predictive features unless time validity is proved.

For a **full three-channel MMM**, add two separate *synthetic* auxiliary tables. Do not pass them off as the original source schema:

### `SIM_MARKETING_PLAN` — new, simulated

**Grain:** one segment × one week × one channel. Target: 6 × 120 × 3 = 2,160 rows. Recommended columns:

| Column | Meaning |
|---|---|
| `segment_id` | Business-defined geography/market segment |
| `week_start` | Monday start of business week |
| `channel` | `coupon`, `retailer_promotion`, or `digital` |
| `planned_spend` | Pre-outcome investment in USD; used for MMM and simulations |
| `planned_exposure` | Optional planned impressions/eligibility/units; if included, explain its units |
| `campaign_id` | Fictional plan/campaign ID, not a transaction redemption ID |
| `plan_created_at` | Timestamp used to prove feature availability before the week |

Marketing plans are generated **before** sales demand, with some correlation between channels and market trends to create realistic estimation challenges. These are not necessarily the same as discount amounts recorded on customer receipts.

### `SIM_MARKET_CONTEXT` — new, simulated

**Grain:** one segment × one week. Target: 720 rows. Recommended columns:

| Column | Meaning |
|---|---|
| `segment_id`, `week_start` | Keys |
| `planned_price_index` | Ex-ante modeled pricing context; distinguish from realized transaction average price |
| `competitor_index` | Simulated external competitor environment |
| `availability_index` | Simulated pre-outcome assortment/availability; **not** store activity inferred from transaction sales |
| `market_size_index` | Optional demand exposure/control |
| `context_as_of` | When information was available |

`holiday`/seasonality can be generated from the calendar. `selling_store_rate`, derived from observed transactions, is a **descriptive post-outcome metric**, not a substitute for a true distribution/availability measure.

If the portfolio intentionally operates in **strict three-source mode** with no auxiliary files, disable digital-spend response, valid spend-based attribution/optimization, and any exogenous indices lacking source evidence. Present source-based promotion-rate descriptive analytics only.

## Generated dataset ordering and provenance

```text
Deterministic stores + products + geographic segment mapping
          + planned campaign budgets + external market context
                               ↓
      Latent synthetic demand with known adstock/saturation truth
                               ↓
           Weekly integer sales totals per market segment
                               ↓
      Allocate units to stores, products, baskets and transaction lines
                               ↓
   Generate receipt-level discount flags, ingestion and quality metadata
                               ↓
    SOURCE_TRANSACTIONS + STORES + BRANDS (source-aligned Parquet)
                               ↓
                Validation / left-join enrichment
                               ↓
            Segment × week mart + model-ready data
```

The synthetic demand-generating mechanism must be consistent with the model target. Example: total integer `sales_units` per segment/week should reconcile to eligible `QUANTITY` in generated transaction lines. Generate ground-truth baseline and promotional contributions **upstream**, store them in evaluation-only metadata, then demonstrate that ETL reconstructs the intended modeling panel from detail data.

## ETL pipeline and join quality

1. Validate all source-aligned column names and nullable/type rules; protect text-like identifiers from CSV numeric inference.
2. Validate composite reference lookup uniqueness. Use bounded left joins; **enriched transaction row count must equal input transaction row count**. Detect and fail/report join fanout.
3. Flag unmatched store/product, missing UPC, ambiguous mapping, unknown segment, source-quality rejection. Preserve raw rows and publish a reconciliation report.
4. Derive `segment_id` from the **documented geography rule applied to store `STANDARD_STATE`**, falling back to `STATE` when standardized state is missing. The six business-defined regions are `northeast` (NY, MA, PA), `southeast` (FL, GA, NC), `great_lakes` (IL, OH, MI), `south_central` (TX, OK, LA), `mountain_west` (CO, UT, NM), and `pacific_coast` (CA, OR, WA). These are not K-means or latent clusters.
5. Define a consistent Monday `week_start` from transaction event time, not submission/processing time. Handle missing transaction timestamps with explicit policies.
6. Derive eligible `sales_units = sum(QUANTITY)` at segment/week from valid transaction lines. Do not equate detail rows with baskets or units.
7. Derive descriptive gross/net sales and promotion/redemption KPIs with documented `PRICE`/discount conventions. Never silently treat net revenue as `PRICE * QUANTITY` if discounts are already included or their semantics unknown.
8. Merge `SIM_MARKETING_PLAN` via `(segment_id, week_start, channel)` after channel pivoting, and `SIM_MARKET_CONTEXT` via `(segment_id, week_start)`. Validate uniqueness; avoid row multiplication.
9. Build a complete six-segment × 120-week calendar scaffold. Zero-fill **only known valid zero-sale weeks**; distinguish missing submissions or gaps from genuine zero demand.
10. Generate `mart_segment_week` and `model_ready` with lineage and QA/exclusion counts. Compare total eligible units against source units (with explained exceptions).
11. Test event versus submission dates, late-arriving correction replay, idempotence of any incremental feature, null UPC, and ambiguous lookups using deterministic fixtures.

## Source column handling details

- `TEST_DATA`, `ERROR_COUNT`, `DISPLAY_ERROR_COUNT`, `STATUS`, `TRANSFORMATION_FLAG`, `TRANSFORMATION_2_PASS_FLAG` and verification flags are retained even when semantics are unknown. Use documented *synthetic-only* conventions for eligibility; do not claim a general real-source filter.
- `ACCOUNT_LOYALTY_ID_NUMBER`, `MARKET_BASKET_TRANSACTION_ID`, `MARKET_BASKET_KEY`, `SCAN_TRANSACTION_ID` and `REGISTER_ID` are different IDs with different scopes. None is an assumed globally unique transaction line key.
- `FILE_SUBMISSION_ID`, `CREATED`, `MODIFIED`, `SUBMISSION_DATE_TIME` and ETL-only ingestion time capture distinct concepts. Late-arriving transactions can belong to past weeks.
- The user's source document reports very large historical statistics snapshots. Those are not targets for simulated scale or a representation of current production counts.

## Key tests and acceptance checklist

- Exact source-aligned inventories: **44 transaction + 42 store + 19 product columns**.
- Stable seeded re-creation and file/content hashes; original 720-row direct-panel dataset is archived, not substituted.
- Source reference uniqueness is validated (not assumed); zero fanout; unmatched lines preserved and counted.
- No unintentional null-to-null product UPC matches.
- Master IDs are distinct from submitted IDs; multiple submitted items may share a master ID without join explosions.
- All 720 intended segment-weeks exist with correct time and exposure coverage.
- `sum(eligible QUANTITY)` equals `sum(mart sales_units)` overall and per segment-week; all exclusions explicitly reconciled.
- Marketing spend totals in final mart equal planned spend in auxiliary plans by channel and segment-week.
- No same-period realized redemption, model truth, or future-as-of information leaks into predictors.
- `AVG_PRICE`/`THIRTEEN_WK_QUANTITY` are **not** used as predictors by default, due to unknown refresh timing.
- Simulated spend plans, source generated transactions and model-ready counts are causally ordered and internally coherent.
- One test injects a duplicate reference key and asserts fail-fast or quarantine; one test injects a missing reference and asserts row preservation.
