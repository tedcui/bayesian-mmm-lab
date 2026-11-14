# Sequential Codex Prompts — Revised Source-Driven Bayesian MMM

> **Status:** M1, M2A, and M2B are complete. The old direct-to-`synthetic_mmm.csv` M2 is **superseded**, and its old files have been removed. Perform **M3** next, then **M4–M8**. Each prompt stops after execution, tests, report, and docs update.
>
> 
> Copy each fenced prompt to Codex separately. Ensure `AGENTS.md`, `docs/SOURCE_SCHEMA_AND_ETL.md`, and `docs/MODELING_DATA_CONTRACT.md` are present at the paths referenced before starting.

## M2A — Migrate existing M2 and simulate actual silver source tables

```text
Read AGENTS.md, docs/SOURCE_SCHEMA_AND_ETL.md, and docs/MODELING_DATA_CONTRACT.md. Inspect the existing M1 and old M2 code and data. Implement M2A ONLY.

1. Preserve M1 tooling: uv, npm, React/Vite, GitHub Actions; do not create a Makefile.
2. Inventory any existing direct-panel M2 CSV, CLI, notebook, and generator. Do not use them as M2A inputs. The previous copies were removed after M2A validation at the user's request; report any remaining direct-panel files as stale.
3. Implement deterministic source simulation under modeling/src/mmm_lab/simulation/ with fixed seed and config. Generate ALL 44 documented transaction, 42 store and 19 product source columns, as separate source-aligned Parquet files:
   data/silver/source_transactions.parquet
   data/silver/source_stores.parquet
   data/silver/source_brands.parquet
4. Preserve source table grains and identifiers. Generate uppercase 32-character hex source IDs where documented, UPC14 as 14-character strings, distinct submitted/master/legacy IDs, submitter context, file submission IDs, event/submission/created timestamps, nullable fields, multiple basket lines, plausible prices, quantities, discount fields and flags. Use invented stores, submitted products and loyalty identifiers ONLY. Document PRICE and synthetic status-code semantics rather than claiming real-world definitions.
5. Create six BUSINESS-DEFINED geographic segments using a documented mapping from STORES.STANDARD_STATE (and documented fallback when needed). These are not machine-learning clusters. Generate 120 Mondays, realistic unequal market size, 120–300 stores and 24–60 product/item records; target roughly 100k–250k transaction detail rows, with configurable size for fast local tests.
6. Add two EXPLICIT synthetic auxiliary sources because the three supplied tables cannot provide planned digital/retailer/coupon spend or independent competitor/availability context:
   data/auxiliary/sim_marketing_plan.parquet
   data/auxiliary/sim_market_context.parquet
   Marketing plan grain = segment × week × channel (2160 records); context grain = segment × week (720 records). Spending must be planned before sales are generated and must never be inferred from customer redemption discounts.
7. Generate the known latent segment-week demand using planned campaigns, market context, segment-specific promotional responses, adstock, saturation, time seasonality, and noise. Draw realized nonnegative integer sales units. THEN allocate those units to stores/products/baskets/transaction detail records so source QUANTITY can be reconciled to the known weekly totals. Generate receipt promotion flags/discounts downstream from the planned campaigns, without falsely equating redeemed discounts with planned spend.
8. Save ground_truth.json containing synthetic generating parameters, true baseline, channel contributions, and realized target by segment-week. Store it outside the observable source and model-training files.
9. Produce a schema/data dictionary, source manifest, deterministic source hashes, and notebooks/00_source_simulation_and_qa.ipynb showing sample source rows, table sizes, keys, geographic groups, submission timing, and planned campaigns.
10. Add tests for schema column inventories, types/nullability, deterministic regeneration, timestamp types, string IDs and UPC leading zeros, product/store identities, basket multiplicity, campaign/context uniqueness, quantity allocation to true target and separation of source versus truth.
11. Make the CLI 'uv run mmm-generate-source' work. Do not create the final model-ready panel directly. Do not implement ETL joins, train models, export frontend results, or build UI.

Run applicable tests and command(s). Report file list, output row counts, checksums, test results, assumptions, synthetic exceptions, and unresolved issues. STOP after M2A.
```

**Checkpoint:** the three supplied source tables should now exist separately; the old 720-row dataset must not be the authoritative synthetic source. New campaign/context tables must be labeled as added synthetic data, not as original source fields.

## M2B — ETL joins, quality controls and downstream 720-row MMM mart

```text
Read AGENTS.md, SOURCE_SCHEMA_AND_ETL.md, MODELING_DATA_CONTRACT.md, and inspect all M2A outputs. Implement M2B ONLY.

1. Implement ETL package modeling/src/mmm_lab/etl/ with reusable validation, enrichment, aggregation, feature processing, and QA report modules.
2. Load source-aligned TRANSACTIONS, STORES, BRANDS. Validate types, required fields, candidate lookup uniqueness and nullable UPC behavior.
3. Join transactions to stores on (SUBMITTER_ID, STORE_ID) and to submitted product reference on (BRAND_ID, UPC14), exactly as observed in the supplied specification. Use LEFT joins, preserve all transaction rows with explicit unmatched/fanout flags. Do not silently match null UPCs to nulls. Do not add SUBMITTER_ID to the product join unless a separate documented validation demonstrates why.
4. Assert enrichment produces no unintended transaction row multiplication. If the source has ambiguous reference matches, report/quarantine them; never arbitrarily choose one without a policy.
5. Derive segment_id using the documented STORES geography rule; derive Monday week_start from TRANSACTION_DATE (event time), not submission timestamps. Preserve FILE_SUBMISSION_ID and source lineage through QA.
6. Use an explicitly documented eligibility policy for synthetic source data; preserve all excluded/unmatched lines and publish exclusion reasons. Source STATUS or transformation flags have unknown real-world business dictionaries, so define simulation-only eligibility semantics.
7. Aggregate transaction units, sample gross/net revenue and redemption metrics to segment × week; do not treat a transaction line as a basket or unit. Distinguish observed active-selling stores from actual distribution/availability controls.
8. Merge separately simulated SIM_MARKETING_PLAN and SIM_MARKET_CONTEXT on unique segment-week/channel keys; pivot planned coupon/retailer/digital spend. Validate exactly one context row and one planned budget per intended cell. Never derive planned spend from realized discount amounts.
9. Build a complete 6 × 120 segment-week panel in data/marts/mart_segment_week.parquet and a leakage-safe model table data/processed/model_ready.parquet (and an optional CSV). Zero-fill only known valid zero-sales weeks; missing ingestion is not equivalent to zero demand.
10. Final model-ready panel should have segment_id, week_start, time_index, is_holdout, sales_units, price_index, distribution_index, competitor_index, holiday, coupon_spend, retailer_promo_spend, and digital_spend. Keep post-outcome discount and promo-line metrics in the descriptive mart, not as default model predictors.
11. Add a train/holdout split of weeks 1–100 vs 101–120. No scaler fitted on holdout. Preserve source/ETL provenance, campaign plan-as-of timing and adstock history.
12. Reconcile sum(eligible source QUANTITY) to sum(mart sales_units) overall and by segment-week, with explicit documented exceptions; reconcile planned spend totals and ensure no duplicate segment-week keys.
13. Implement 'uv run mmm-build-mart', output reconciliation and quality reports, and create notebook 01_data_exploration.ipynb to inspect the actual downstream mart.
14. Add tests for joined reference fanout, missing references, nullable UPC, duplicate lookup-key fixture, late-arriving source submission, independent time axes, idempotence where supported, crosswalk preservation, leakage controls, quantity reconciliation and complete calendar coverage.
15. Validate regenerated model_ready only comes from M2A source and auxiliary files. Do not call the old standalone direct-panel simulation to populate it.

Run the CLI and tests. Report input/output row counts, join coverage, reconciliation totals, excluded rows, source-to-feature mappings, test results, and limitations. STOP after M2B.
```

**Checkpoint:** every model-ready row must be traceable to source transaction quantities and auxiliary pre-outcome plans; no source joins may inflate units. Only after M2B acceptance should fitting start.

## M3 — Bayesian hierarchical MMM + rigorous evaluation on ETL panel

```text
Read AGENTS.md, MODELING_DATA_CONTRACT.md and the M2B reconciliation report. Implement M3 ONLY.

1. Confirm that data/processed/model_ready.parquet was generated through the source-to-mart ETL. Reject old standalone synthetic_mmm.csv as the model input.
2. Verify installed version-pinned PyMC-Marketing, PyMC, and ArviZ capabilities. Use the supported hierarchical PyMC-Marketing implementation or lower-level PyMC if needed for correct segment-specific priors. Document the choice; never use invented API methods.
3. Fit three ACTUAL specifications with the same valid covariates/transformations: complete pooling, no pooling, and hierarchical partial pooling for segment/channel response parameters. Use shared adstock and saturation shapes initially, explicit priors and sensible identifiability constraints.
4. Target weekly sales_units (not baskets, revenue, or post-outcome promotion rate). Controls must come from pre-outcome context or calendar; campaign spend must come from SIM_MARKETING_PLAN. Exclude direct ground-truth parameters, contemporaneous redeemed discounts and any source AVG_PRICE/THIRTEEN_WK_QUANTITY with unknown as-of semantics.
5. Train weeks 1–100; evaluate weeks 101–120 with correct adstock carryover and documented known-future covariate assumptions. Implement model fitting and evaluation as package functions / CLI commands, not just notebook cells.
6. Produce notebooks/02_bayesian_hierarchical_mmm.ipynb and 03_model_evaluation.ipynb, covering model equations, prior predictive checks, posterior samples, R-hat/ESS/divergences, trace diagnostics, posterior predictive checks, holdout MAE/WAPE/bias/interval coverage, parameter recovery and contribution recovery against synthetic truth, weak-segment shrinkage, and sensitivity to correlated campaigns.
7. Show strengths and weaknesses of partial pooling; never assert it always wins. Report weakly identified effects and confounding risks.
8. Store reproducible inference/diagnostic artifacts and model-input lineage hash. Implement uv run mmm-fit and uv run mmm-evaluate.
9. Add tests for model dimensions, expected sales/contribution consistency, train/holdout temporal controls, transformation ordering, truth separation, and result serialization.

Actually fit and evaluate. If convergence, recovery or predictive checks are poor, diagnose them, document limitations and stop. Do not fabricate model outputs or proceed to frontend exports. Report results and STOP after M3.
```

## M4 — Versioned exports for browser analytics and posterior simulation

```text
Read AGENTS.md and MODELING_DATA_CONTRACT.md. Verify accepted M3 outputs and upstream M2B lineage. Implement M4 ONLY.

1. Build modeling/src/mmm_lab/export.py and the uv run mmm-export CLI.
2. Generate versioned web/public/model-data/manifest.json, overview.json, contributions.json, segments.json and simulator.json from ACTUAL model posterior objects and ETL-produced features.
3. Include source/ETL/model hashes and identifiers in manifest to prevent mixing old M2 exports with new source-driven mart outputs.
4. Export observed vs predicted expected sales, uncertainty bands and holdout metrics; baseline/channel contributions by segment/week; fitted pooling coefficients with intervals and synthetic truth for comparison; and a small jointly sampled posterior subset for simulator with exact adstock/saturation parameters and historical spend.
5. Summarize aggregates by adding components within posterior draws before computing quantiles. Distinguish expected-sales credible intervals versus future-sales predictive intervals.
6. Define matching TypeScript types and runtime schema validation. Test numeric reconciliation, dates, segment/channel alignment, version hashes, payload sizes, and posterior draw joint indexing.
7. Never expose row-level transaction details, fake store contact data, source-specific internal identifiers, or large inference files in public web JSON.

Run uv run mmm-export, Python tests, TypeScript type checks. Report validation and payload sizes, then STOP after M4.
```

## M5 — Overview, Decomposition, Segment Comparison and Partial Pooling

```text
Read AGENTS.md and M4 export schemas. Implement M5 ONLY.

1. Build a NEW React/TypeScript/Vite/Plotly/Tailwind analytics UI. Do not reuse previous healthcare dashboard code or style.
2. Overview page: select segment/date, show observed vs model-predicted sales with intervals, train/holdout boundary, model WAPE/MAE, planned marketing spending and explanatory tooltips.
3. Decomposition page: show modeled baseline demand + three channel contributions, uncertainty and residual reconciliation. Describe as model-based contributions, not experimentally proven causal lift.
4. Segment comparison page: compare genuinely fitted full/no/partial pooling effects and credible intervals for segment × channel, with optional synthetic truth overlay and a focused small-data shrinkage explanation.
5. Make clear the six segments are business-defined regions based on STORES geography, not AI-generated clusters.
6. Load only versioned export JSON. Ensure filter consistency, accessible responsive layout, no static placeholder metrics and no exposure of simulated source contact data.
7. Add tests for schema validation, aggregations, interval labels, filter updates, malformed data and runtime failure states.

Run npm typecheck/tests/build, report exact results and limitations, then STOP after M5. Do not implement the decision simulator yet.
```

## M6 — Posterior-based decision simulator and optimization

```text
Read AGENTS.md, MODELING_DATA_CONTRACT.md and M4 simulator export. Implement M6 ONLY.

1. Implement Python reference scenario evaluator in modeling/src/mmm_lab/scenario.py and TypeScript equivalent web/src/lib/scenario.ts.
2. Input: a selected business region, three channels' PLANNED marketing spend and a 12-week scenario horizon. Never use transaction coupon-redemption amount as marketing budget.
3. Per matched posterior draw, use exact fitted marketing transformation parameters, true pre-horizon spending history, and held-fixed nonmarketing covariates. Compute baseline and alternative expected sales and the scenario-minus-baseline draw-level difference.
4. UI: segment selection, baseline and alternate planned budget, coupon/retailer/digital sliders, total budget, expected incremental units, credible intervals, channel changes, reset and extrapolation warning.
5. Verify unchanged scenario gives zero incremental expected units, paired posterior draws are preserved, adstock history is used and simulated spend stays in supported ranges.
6. Add deterministic fixtures proving Python/TypeScript numerical parity within documented tolerance.
7. Only once manual simulation passes, implement bounded fixed-budget optimization of expected modeled sales. Use channel caps and feasibility checks. Do not label the result profit or ROI without defined economic values.
8. Document causal-assumption limitations and keep data source provenance visible in the app documentation.

Run Python and frontend tests and build, report parity results and constraints, and STOP after M6.
```

## M7 — GitHub Pages QA and deployment preparation

```text
Read AGENTS.md and inspect M1–M6 deliverables. Implement M7 ONLY.

1. Validate source schema tests, ETL joins/reconciliation, model export consistency, Python/TS simulator parity, frontend typecheck/unit tests and production build. Do not run full MCMC in routine CI.
2. Verify the full UI and documentation disclose that data are simulated and model outputs are assumption dependent. Remove placeholder metrics and prevent public JSON containing row-level operational details.
3. Configure GitHub Pages Vite base '/bayesian-mmm-lab/' and static-compatible navigation. GitHub Actions should build and deploy validated web/dist with committed lightweight exports, not retrain MCMC on every push.
4. Review privacy and disclosure risks from organization-specific source names and supplied schema metadata. Recommend anonymization before public publishing if needed; do not automatically publish private-looking source-schema docs.
5. Update README with uv, npm, schema/ETL pipeline, source-to-mart lineage, model regeneration, dashboard and hosting instructions. No Makefile.
6. Run tests and build, report results. Do not push, deploy or publish externally without explicit user authorization. STOP after M7.
```

## M8 — Optional Cloudflare Workers AI explanation layer

```text
Read AGENTS.md and verify that the GitHub Pages app is independently functional. Implement M8 ONLY.

Add an optional Cloudflare Worker with Workers AI to explain ONLY validated exported model summaries and scenario results. Restrict input/output schema and origins; keep credentials on Worker side; validate requests, add rate limits, safe error handling and fallback when AI is unavailable.

Supported questions: why partial pooling changes estimates, why a region's interval is wide, what modeled contributions imply, and how a spending scenario changes expected sales. The LLM must not fit the model, invent model coefficients, access row-level source tables, claim causal lift from observational MMM, or make unsupported business recommendations.

Add grounded-output, malformed-request, injection-resistance and fallback tests. Do not deploy without authorization. Report tests and STOP after M8.
```

## Review gates at a glance

| Gate | What must be true to proceed |
|---|---|
| After M2A | Three source-aligned Parquet tables exist, all columns valid, campaign/context sources separate, demand truth reconcilable to detail QUANTITY |
| After M2B | Enrichment has no join fanout, 720-row mart from source, units/budget reconciliation, no post-outcome leakage |
| After M3 | Real models fitted, diagnostics and synthetic-truth recovery reported honestly |
| After M4 | Browser JSON is generated from the accepted posterior and correct ETL lineage |
| After M5 | Three analytical pages work; segment effects are actual fitted estimates |
| After M6 | Python and TypeScript scenarios agree; reset-to-baseline returns zero; optimizer feasible |
| After M7 | Static site is buildable, source metadata disclosure reviewed, deployment approved separately |
| After M8 | Cloudflare AI remains a grounded optional explainer |
