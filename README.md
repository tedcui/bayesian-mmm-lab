# Bayesian MMM Decision Lab

A synthetic, source-driven Bayesian marketing mix modeling demonstration. M3 fits and evaluates three real Bayesian pooling specifications on the validated M2B panel. There are no analytical frontend results yet.

## Current architecture

- Python 3.12 package in `modeling/`, managed with `uv`
- Three simulated, source-aligned silver Parquet tables in `data/silver/`
- Two explicitly **additional synthetic** pre-outcome sources in `data/auxiliary/`
- Evaluation-only truth, manifest, QA report, and [source data dictionary](data/metadata/source_data_dictionary.md) in `data/metadata/`
- Reconciled 720-row segment-week mart, leakage-safe model projection, [ETL dictionary](data/metadata/etl_data_dictionary.md), and QA/lineage reports
- Three PyMC posterior fits, [model specification](docs/MODEL_SPECIFICATION.md), and [evaluation report](modeling/artifacts/evaluation.json)
- React/TypeScript/Vite foundation in `web/`; its current screen is a setup placeholder
- GitHub Actions CI for lightweight checks; no deployment is enabled

The exact 44 transaction, 42 store, and 19 product column inventories are documented in [the source contract](docs/SOURCE_SCHEMA_AND_ETL.md). [The modeling data contract](docs/MODELING_DATA_CONTRACT.md) describes the later source-to-mart route. [Milestone prompts](docs/CODEX_PROMPTS.md) supersede the earlier direct-panel M2.

## Setup and generation

Install Python 3.12 and `uv`. From `modeling/`:

```sh
uv sync --locked
uv run --locked mmm-generate-source
uv run --locked mmm-build-mart
uv run --locked mmm-fit
uv run --locked mmm-evaluate
uv run --locked pytest -q
uv run --locked jupyter lab
```

Open the notebooks in `../notebooks/` with the kernel at `modeling/.venv/Scripts/python.exe` on Windows. Notebook 02 inspects the saved fits and can call `fit_models()` if artifacts are absent; notebook 03 evaluates them. A full fit takes several minutes and does not run during normal CI or frontend builds. On Windows PowerShell with script execution disabled, use `npm.cmd` in place of `npm` for frontend commands.

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

## Reproducibility and artifact policy

`modeling/uv.lock` and `web/package-lock.json` are committed. `paths.py` resolves repository paths independently of the working directory. Large generated transaction, enriched-fact, and posterior NetCDF files and temporary Python/frontend build files are ignored by Git; regenerate them with the CLIs. Compact fit/evaluation JSON and notebooks without saved outputs are reviewable. Fixed RNG seeds and input hashes support reproducibility; platform-level MCMC bitwise identity is not promised. No full MCMC runs in ordinary CI.

The fixed synthetic equations, complete references, and known truth make engineering checks possible but simplify real observational marketing data. Correlated campaigns, promotion-linked price changes, imperfect targeting, unknown source semantics, and possible missing or revised records limit later causal interpretation. The truth file is evaluation-only and must never become a model feature. No public source data or deployment has been created.

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

These local checks do not establish causal promotion effects or a live public website. M4, versioned fitted-model exports, is the next suggested milestone after reviewing M3's weak effect identification.
