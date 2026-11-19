# Bayesian MMM Decision Lab

A synthetic, source-driven Bayesian marketing mix modeling demonstration. M3 fits and evaluates three real Bayesian pooling specifications on the validated M2B panel; M4 exports their versioned results; M5–M6 present them in a four-page analytical dashboard and conditional decision simulator. The static dashboard is published at [tedcui.github.io/bayesian-mmm-lab](https://tedcui.github.io/bayesian-mmm-lab/).

## Current architecture

- Python 3.12 package in `modeling/`, managed with `uv`
- Three simulated, source-aligned silver Parquet tables in `data/silver/`
- Two explicitly **additional synthetic** pre-outcome sources in `data/auxiliary/`
- Evaluation-only truth, manifest, QA report, and [source data dictionary](data/metadata/source_data_dictionary.md) in `data/metadata/`
- Reconciled 720-row segment-week mart, leakage-safe model projection, [ETL dictionary](data/metadata/etl_data_dictionary.md), and QA/lineage reports
- Three PyMC posterior fits, [model specification](docs/MODEL_SPECIFICATION.md), and [evaluation report](modeling/artifacts/evaluation.json)
- Versioned, lineage-checked [M4 browser exports](docs/EXPORT_CONTRACT.md) in `web/public/model-data/`
- React/TypeScript/Vite, Plotly and Tailwind analytical dashboard in `web/`, with Overview, Decomposition, Segment Comparison and Decision Simulator pages
- GitHub Actions CI for locked checks and a manual-only Pages workflow for a future standalone source repository

The exact 44 transaction, 42 store, and 19 product column inventories are documented in [the source contract](docs/SOURCE_SCHEMA_AND_ETL.md). [The modeling data contract](docs/MODELING_DATA_CONTRACT.md) describes the later source-to-mart route. [Milestone prompts](docs/CODEX_PROMPTS.md) supersede the earlier direct-panel M2.

## Setup and generation

Install Python 3.12 and `uv`. From `modeling/`, the full regeneration sequence is:

```sh
uv sync --locked
uv run --locked mmm-generate-source
uv run --locked mmm-build-mart
uv run --locked mmm-fit
uv run --locked mmm-evaluate
uv run --locked mmm-export
uv run --locked pytest -q
uv run --locked jupyter lab
```

Open the notebooks in `../notebooks/` with the kernel at `modeling/.venv/Scripts/python.exe` on Windows. Notebook 02 inspects the saved fits and can call `fit_models()` if artifacts are absent; notebook 03 evaluates them. A full fit takes several minutes and does not run during normal CI or frontend builds. On Windows PowerShell with script execution disabled, use `npm.cmd` in place of `npm` for frontend commands.

The committed browser export lets you run the dashboard without fitting MCMC. From `web/`, run `npm ci`, `npm run validate:public`, `npm test`, and `npm run dev`; open the Vite URL ending in `/bayesian-mmm-lab/`. The project uses `uv` and npm lockfiles; there is no Makefile.

The default seed is `20261113`. Six business regions—Northeast, Southeast, Great Lakes, South Central, Mountain West, and Pacific Coast—are derived from store geography. Their exact state mapping and stable `segment_id` values are in the [source data dictionary](data/metadata/source_data_dictionary.md). There are 120 Monday weeks from 2023-01-02, 190 stores, 36 submitted product records, 171,741 transaction details, 2,160 segment-week-channel marketing plans, and 720 segment-week context rows. The 601,108 allocated transaction units match the known synthetic demand targets exactly. Transaction detail is generated **after** planned campaigns, context, and latent demand. Receipt discounts are observations, not planned marketing budgets.

For fast development tests, `SimulationConfig(weeks=4, unit_scale=0.1)` reduces the quantity of generated detail while preserving the full source schemas. The CLI uses the default configuration. `source_manifest.json` includes file checksums, schema hash, generation order, and simulation-only field semantics. `source_quality.json` records schema, reference, key, and unit-reconciliation checks.

## Superseded direct-panel M2

The earlier M2 built `synthetic_mmm.csv` and `model_ready.csv` directly. After M2A source generation and reconciliation passed, its archived CSVs, metadata, generator, preprocessor, tests, notebook, and the one-time migration guide were removed at the user's request. The direct-panel CLI was already retired. The new source files and auxiliary plans are the only active synthetic inputs.

M2B validates source hashes and Arrow schemas, enriches every transaction line with two nonmultiplying LEFT joins, records exclusions and lineage, aggregates eligible units, then merges independent planned spend and pre-outcome context. Its `model_ready.parquet` is built only from M2A source and auxiliary files. It retains all 120 weeks per segment, including history needed for adstock. Weeks 1–100 train and 101–120 hold out. Missing eligible segment-weeks fail rather than silently become zero sales. No scaler is fitted in M2B. See the [ETL dictionary](data/metadata/etl_data_dictionary.md) for source-to-feature mappings and limitations.

## M3 fitted results

PyMC 6.4.0 and ArviZ 1.3.0 are pinned. All three models use the same fitted channel-level geometric adstock, Hill saturation, controls, and Normal likelihood. Only the segment/channel response pooling differs. The fit loader verifies the M2B model-input hash and never opens synthetic truth. The evaluator uses truth only after fitting. See the [equations and priors](docs/MODEL_SPECIFICATION.md) and [full metrics](modeling/artifacts/evaluation.json).

| Pooling | Max R-hat | Min bulk ESS | Divergences | Conditional holdout WAPE | 90% coefficient truth coverage |
|---|---:|---:|---:|---:|---:|
| Complete | 1.0056 | 266.3 | 0 | 4.044% | 12/18 |
| None | 1.0097 | 427.7 | 0 | 4.058% | 17/18 |
| Partial | 1.0043 | 1,146.4 | 0 | 4.040% | 15/18 |

The first hierarchical run had 3 divergences and max R-hat 1.0192. A documented rerun with 4 chains, 1,000 tuning steps, 800 draws per chain, and `target_accept=0.98` removed those diagnostic failures; complete and no pooling used 2 chains, 600 tuning steps, and 600 draws per chain. All fitted files and settings are in `modeling/artifacts/fit_manifest.json`; large NetCDF posteriors are local and gitignored.

Holdout accuracy does **not** establish channel identification. The partial model's 90% response intervals cover 15/18 true maximum effects, and its small-region retailer/digital effect means exceed truth while remaining uncertain. Shared adstock decay intervals all contain truth but are broad. Campaign spend correlations are about 0.40–0.64 within regions. Reweighting the hierarchical log population prior from standard deviation 0.7 to 1.0 shifts mean response coefficients by up to 9.696 units with importance ESS 2,172.9/3,200; this is a local sensitivity check, not a new fit. The [evaluation report](modeling/artifacts/evaluation.json) contains per-channel recovery, baseline/contribution checks, and limitations. Promotional contributions are model-based, assumption-dependent estimates, not experiment-validated incrementality.

## M4 model exports

`mmm-export` checks source, ETL, model-input, fit, evaluation, and posterior hashes before writing five static JSON files. `overview.json` and `contributions.json` cover all 720 segment-weeks and 21 draw-first aggregates. `segments.json` compares all three fitted specifications against simulation truth. `simulator.json` carries 96 jointly indexed partial-pooling draws, exact transformation parameters, prior spend history, a 12-week holdout replay plan, fixed controls, and spend support bounds. The four data payloads total **1,501,691 bytes** before compression; no transaction details or full posterior files are public. See the [export contract](docs/EXPORT_CONTRACT.md) for schemas and interval semantics.

Partial pooling is a labeled educational reference for the weekly export, **not** the statistically best recovered segment-effect model. The exported comparison shows no pooling's stronger coefficient recovery. Expected-sales credible intervals and future-observation predictive intervals are separate. The simulator plan is a conditional historical replay, not an unconditional forecast; M6 uses its fitted posterior draws in the browser.

## M5 analytical dashboard

From `web/`, run `npm ci` and `npm run dev`, then open the local Vite address. The app loads the versioned M4 JSON bundle, verifies payload hashes and schemas, and shows an error with retry if validation fails. Navigation uses static-host-compatible hash routes. No operational transaction or contact details are loaded by the browser.

- **Overview** defaults to **All regions** and supports a business-region filter and inclusive week range. Quick buttons select all 120 weeks, training weeks 1–100, or holdout weeks 101–120; the date selectors allow a custom range. It shows observed sales, partial-pooling expected sales, planned channel spending, and WAPE/MAE computed only over holdout weeks in the selected range. Regional and all-region weekly observations have 90% *predictive* intervals. The first holdout week is marked on the chart.
- **Decomposition** defaults to **All regions** and displays posterior mean baseline and three modeled channel contributions, a selectable channel's weekly 90% *credible* interval, and observed = expected + residual reconciliation. Model-based contributions depend on assumptions and are not experimentally proven lift.
- **Region Comparison** shows three fitted pooling approaches, their 90% credible intervals, and holdout sales error. The selected region is a focus for explaining partial pooling. Its effects were fitted on the fixed 100-week training window; date filters do not refit coefficients. Diagnostic and synthetic-truth evaluation fields remain in model exports and research artifacts, outside the dashboard interface.

The all-region weekly charts sum observed values and posterior means across the six regions. Weekly uncertainty bands come from summing regions within each joint posterior draw before computing percentiles. For exact full, training or holdout windows, the app displays exported draw-first total credible intervals. For a custom date range it shows sums of weekly means and omits a total interval; percentile endpoints cannot be summed. All-region holdout WAPE and MAE use errors after summing each week's regional predictions and observations. Holdout predictions are conditional on planned spend and pre-outcome context, not ex-ante forecasts. Correlated promotions and targeting limit causal interpretation even in this synthetic demonstration. The decision simulator is described below.

## M6A reference scenario engine

Python and TypeScript now evaluate paired 12-week planned-spend alternatives from the **same 96 fitted partial-pooling draws**. They carry forward all 108 prior weeks of adstock, apply the exact M3 Hill transformation and fixed controls, and return expected-unit and channel differences with 90% parameter credible intervals. The spend-pattern scaling helper adjusts each channel's existing weekly plan. Support flags identify proposals beyond training or observed spending maxima. No simulator page or optimizer is included in M6A. See the [scenario engine contract](docs/SCENARIO_ENGINE.md) for equations, units, fixture regeneration and limitations.

## M6B decision simulator

From `web/`, run `npm ci` and `npm run dev`, then open `#/simulator`. Choose a region and move any of the three planned-spend controls; each starts at 100% of that channel's exported 12-week plan and scales its **weekly** values. Reset restores the baseline. The page compares baseline and alternative expected sales with posterior means and central 90% credible intervals, paired incremental expected units, each channel's modeled response change, and exact 12-week planned USD totals. Its chart and warnings explain uncertainty and spending outside training or observed support.

Enter a single absolute 12-week USD budget to search for an allocation across channels. The bounded local search evaluates each candidate with the same 96-draw scenario engine, preserves each channel's original weekly spend profile, and caps every week at the exported observed maximum. It reports infeasibility and boundary allocations; it does not claim a global optimum. The objective is modeled incremental expected **units**, not profit or ROI. This is a conditional historical replay under fixed controls, not an ex-ante forecast or experimentally identified causal lift. The partial-pooling reference covered 15/18 known synthetic coefficients versus 17/18 for no pooling. See [the M6 contract](docs/SCENARIO_ENGINE.md) for the equations, support rules, provenance and validation.

## M7 local release preparation and hosting

The four hash routes are `#/overview`, `#/decomposition`, `#/segments`, and `#/simulator`. The Vite base is `/bayesian-mmm-lab/`, so the local preview and intended GitHub Pages project URL use that subpath. From `web/`, run `npm ci`, `npm run validate:public`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run validate:dist`; then `npm run preview` to inspect the built site. The release validator checks the exact five committed JSON files, manifest hashes, the approved posterior subset, the Pages asset paths, and unexpected or sensitive artifact files. CI runs Python source-generation/ETL tests and these frontend gates without refitting the Bayesian models.

The source repository is [tedcui/bayesian-mmm-lab](https://github.com/tedcui/bayesian-mmm-lab). Its manual [Pages workflow](.github/workflows/deploy.yml) builds `web/` and publishes the static dashboard at `/bayesian-mmm-lab/`; normal CI does not fit the Bayesian models. The [public-release review](docs/PUBLIC_RELEASE_REVIEW.md) records the source-schema disclosure and identification limitations. The portfolio repository, `tedcui/tedcui.github.io`, hosts the portfolio homepage and case studies separately.

## Reproducibility and artifact policy

`modeling/uv.lock` and `web/package-lock.json` are committed. `paths.py` resolves repository paths independently of the working directory. Large generated transaction, enriched-fact, and posterior NetCDF files and temporary Python/frontend build files are ignored by Git; regenerate them with the CLIs. Compact fit/evaluation JSON and notebooks without saved outputs are reviewable. Fixed RNG seeds and input hashes support reproducibility; platform-level MCMC bitwise identity is not promised. No full MCMC runs in ordinary CI.

The fixed synthetic equations, complete references, and known truth make engineering checks possible but simplify real observational marketing data. Correlated campaigns, promotion-linked price changes, imperfect targeting, unknown source semantics, and possible missing or revised records limit later causal interpretation. The truth file is evaluation-only and must never become a model feature. All committed example data are synthetic.

## Verification

| Milestone | Command | Result |
|---|---|---|
| M1 | `uv sync --locked`; `uv run --locked pytest -q` | Passed; 1 foundation test |
| M1 | `npm ci`; `npm run typecheck`; `npm test`; `npm run build` | Passed at foundation milestone |
| M2A | `uv run --locked mmm-generate-source` | Passed; row counts above and SHA256 checksums in source manifest |
| M2A | `uv run --locked pytest -q` | Passed; 11 tests |
| M2A | Notebook execution | Passed; all 6 code cells executed |
| M2B | `uv sync --offline`; `uv run --offline --locked mmm-build-mart` | Passed; 171,741 lines joined, 601,108 units reconciled, 720 mart rows |
| M2B | `uv run --offline --locked pytest -q` | Passed; 21 tests |
| M2B | Notebook execution | Passed; all 5 code cells executed |
| M3 | `uv run --offline --locked mmm-fit`; partial rerun with `--pooling partial --draws 800 --tune 1000 --chains 4 --target-accept 0.98` | Three actual posterior fits saved; final diagnostics above |
| M3 | `uv run --offline --locked mmm-evaluate` | Passed; verified posterior/input hashes and saved conditional holdout/recovery diagnostics |
| M3 | `uv run --offline --locked pytest -q` | Passed; 26 tests |
| M3 | Notebook 02 and 03 execution | Passed; 4 and 5 code cells respectively |
| M4 | `uv run --offline --locked mmm-export` | Passed; five lineage-bound JSON files, payload sizes above |
| M4 | `uv run --offline --locked pytest -q` | Passed; 32 tests |
| M4 | `npm.cmd run typecheck`; `npm.cmd test`; `npm.cmd run build` | Passed; 4 frontend tests and static build |
| M5 | `npm.cmd run typecheck`; `npm.cmd test`; `npm.cmd run build` | Passed; 8 frontend tests across 3 files and static build |
| M6A | `uv run --offline --locked pytest -q`; `npm.cmd ci`; `npm.cmd run typecheck`; `npm.cmd test`; `npm.cmd run build` | 38 Python and 12 frontend tests passed; 96-draw paired parity and baseline reconstruction passed |
| M6B | `uv run --offline --locked --no-sync pytest -q` with a temporary `UV_CACHE_DIR`; `npm.cmd run typecheck`; `npm.cmd test`; `npm.cmd run build` | 38 Python and 16 frontend tests passed; 96-draw parity, UI reset, budget feasibility, spend-cap checks, and static build passed |
| M7 | `uv sync --offline --locked`; `uv run --locked mmm-generate-source`; `uv run --locked mmm-build-mart`; `uv run --locked pytest -q`; `npm.cmd ci`; `npm.cmd run validate:public`; `npm.cmd run typecheck`; `npm.cmd test`; `npm.cmd run build`; `npm.cmd run validate:dist` | 38 Python and 16 frontend tests passed; source/ETL reconciliation, export/artifact hashes and Pages subpath passed; visual browser QA pending |
| Dashboard usability review | `uv run --offline --locked pytest -q`; `npm.cmd run validate:public`; `npm.cmd run typecheck`; `npm.cmd test`; `npm.cmd run build`; `npm.cmd run validate:dist` | 38 Python and 18 frontend tests passed; quick date ranges, readable secondary text, and built artifact validated; visual browser QA pending |

These local checks do not establish causal promotion effects. Confirm the current Pages deployment in GitHub Actions and inspect the live dashboard separately.
