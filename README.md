# Bayesian MMM Decision Lab

A synthetic, source-driven Bayesian marketing mix modeling demonstration. The long-term product will fit real hierarchical models and show assumption-dependent contributions and budget scenarios. M2A contains the operational source simulation only; there are no fitted models or analytical frontend results.

## Current architecture

- Python 3.12 package in `modeling/`, managed with `uv`
- Three simulated, source-aligned silver Parquet tables in `data/silver/`
- Two explicitly **additional synthetic** pre-outcome sources in `data/auxiliary/`
- Evaluation-only truth, manifest, QA report, and [source data dictionary](data/metadata/source_data_dictionary.md) in `data/metadata/`
- React/TypeScript/Vite foundation in `web/`; its current screen is a setup placeholder
- GitHub Actions CI for lightweight checks; no deployment is enabled

The exact 44 transaction, 42 store, and 19 product column inventories are documented in [the source contract](docs/SOURCE_SCHEMA_AND_ETL.md). [The modeling data contract](docs/MODELING_DATA_CONTRACT.md) describes the later source-to-mart route. [Milestone prompts](docs/CODEX_PROMPTS.md) supersede the earlier direct-panel M2.

## Setup and generation

Install Python 3.12 and `uv`. From `modeling/`:

```sh
uv sync --locked
uv run --locked mmm-generate-source
uv run --locked pytest -q
uv run --locked jupyter lab
```

Open `../notebooks/00_source_simulation_and_qa.ipynb` with the kernel at `modeling/.venv/Scripts/python.exe` on Windows. The notebook imports `mmm_lab` and reads generated sources. It contains no model fitting or ETL. On Windows PowerShell with script execution disabled, use `npm.cmd` in place of `npm` for frontend commands. The frontend foundation still uses `npm ci`, `npm run typecheck`, `npm test`, and `npm run build` from `web/`.

The default seed is `20261113`. Six business regions—Northeast, Southeast, Great Lakes, South Central, Mountain West, and Pacific Coast—are derived from store geography. Their exact state mapping and stable `segment_id` values are in the [source data dictionary](data/metadata/source_data_dictionary.md). There are 120 Monday weeks from 2023-01-02, 190 stores, 36 submitted product records, 171,741 transaction details, 2,160 segment-week-channel marketing plans, and 720 segment-week context rows. The 601,108 allocated transaction units match the known synthetic demand targets exactly. Transaction detail is generated **after** planned campaigns, context, and latent demand. Receipt discounts are observations, not planned marketing budgets.

For fast development tests, `SimulationConfig(weeks=4, unit_scale=0.1)` reduces the quantity of generated detail while preserving the full source schemas. The CLI uses the default configuration. `source_manifest.json` includes file checksums, schema hash, generation order, and simulation-only field semantics. `source_quality.json` records schema, reference, key, and unit-reconciliation checks.

## Archived previous M2

The earlier M2 built `synthetic_mmm.csv` and `model_ready.csv` directly. Those files, their generator, preprocessor, tests, notebook, and metadata are preserved under [data/legacy/direct_panel_m2](data/legacy/direct_panel_m2/README.md) with an SHA256 archive manifest. The active direct-panel files and CLI were retired. That route is historical and must not feed the later model.

M2A does **not** produce a mart or `model_ready` dataset. M2B is the next milestone: validate/enrich the source tables, aggregate transaction quantities to segment-week, join independently planned spend and pre-outcome context, reconcile units, then create the leakage-safe panel. The active `01_data_exploration.ipynb` is reserved for that ETL result.

## Reproducibility and artifact policy

`modeling/uv.lock` and `web/package-lock.json` are committed. `paths.py` resolves repository paths independently of the working directory. The generated source files, truth, manifest, QA report, compact auxiliary files, and archival material are reviewable locally. Large generated transaction Parquet and temporary Python/frontend build files are ignored by Git; regenerate the source with the CLI. No full MCMC runs in ordinary CI.

The fixed synthetic equations, complete references, and known truth make engineering checks possible but simplify real observational marketing data. Correlated campaigns, promotion-linked price changes, imperfect targeting, unknown source semantics, and possible missing or revised records limit later causal interpretation. The truth file is evaluation-only and must never become a model feature. No public source data or deployment has been created.

## Verification

| Milestone | Command | Result |
|---|---|---|
| M1 | `uv sync --locked`; `uv run --locked pytest -q` | Passed; 1 foundation test |
| M1 | `npm ci`; `npm run typecheck`; `npm test`; `npm run build` | Passed at foundation milestone |
| M2A | `uv run --locked mmm-generate-source` | Passed; row counts above and SHA256 checksums in source manifest |
| M2A | `uv run --locked pytest -q` | Passed; 11 tests |
| M2A | Notebook execution | Passed; all 6 code cells executed |

M2A checks are local. They do not establish that a model fits, that source-based estimates are causal, or that a public website is live.
