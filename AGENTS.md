# AGENTS.md — Bayesian MMM Decision Lab

## Project mission

Build an independent, interview-quality Bayesian Hierarchical Marketing Mix Modeling (MMM) demonstration using **reproducible synthetic data**, a **real, validated Bayesian model**, and a **responsive interactive web application**.

The product should teach and demonstrate how to understand baseline demand, compare promotional contributions across heterogeneous market segments, quantify uncertainty, and evaluate alternative promotional budgets.

**Non-goals for the initial release:** real healthcare or client data; a CareDx-specific dashboard; adapting UI or code from the existing healthcare AI dashboard; live model training in the browser; and an AI chat interface before the statistical app is validated. The only infrastructure conventions carried over are **GitHub Pages for hosting** and, optionally later, **Cloudflare Workers AI**.

## How the agent should work

1. Read this file and the relevant existing code before making changes.
2. Work on **one milestone at a time**. Do not silently implement later phases.
3. Make the smallest maintainable set of changes needed to complete the current milestone.
4. At the end of a milestone, report: files changed, commands run, test results, known limitations, and the next suggested milestone. Do not claim tests passed unless they were run.
5. Prefer explicit, documented statistical assumptions over clever or opaque implementations.
6. Do not fabricate fitted coefficients, intervals, fit metrics, sales impact, or validation results. Clearly label any early UI mockups as placeholders; remove all placeholder metrics from production views.
7. Keep synthetic ground truth separate from training inputs. It may be used for evaluation, not passed to a model as a feature.
8. Write tests for new numerical logic and interface contracts, and preserve deterministic random seeds for reproducibility.
9. Update documentation when commands, schemas, assumptions, or architecture change.
10. Never introduce client-confidential data, protected health information, secrets, or private API credentials.
11. Do not deploy, publish, push, or make external service changes without explicit authorization. Local commits may be created when requested for the milestone.
12. If a statistical or technical acceptance criterion fails, report and diagnose it rather than masking it or substituting a static demo.

## Tooling policy — NO Makefile

**Do not create a `Makefile` and do not require GNU Make.** The developer may be using Windows.

Use the following native tools instead:

| Area | Tool | Purpose |
|---|---|---|
| Python | `uv` | Manage environments, lock dependencies, run scripts and tests |
| Python project metadata | `modeling/pyproject.toml` | Dependencies, package metadata and CLI entry points |
| Python lockfile | `modeling/uv.lock` | Reproducible Python environment; commit this file |
| Frontend | `npm` | Install dependencies and run development/build/test scripts |
| Frontend metadata | `web/package.json` | Frontend scripts and dependencies |
| Frontend lockfile | `web/package-lock.json` | Reproducible npm installs; commit this file |
| CI/deployment | GitHub Actions | Test/build frontend and deploy static assets to GitHub Pages |

Use Python 3.12 as the initial project target unless dependency compatibility requires a documented adjustment. Use modern Node.js LTS; pin the runtime major in CI.

### Standard local commands

From `modeling/` (once the relevant CLI functions are implemented):

```bash
uv sync
uv run mmm-generate
uv run mmm-fit
uv run mmm-evaluate
uv run mmm-export
uv run pytest
uv run jupyter lab
```

From `web/`:

```bash
npm ci
npm run dev
npm run typecheck
npm test
npm run build
npm run preview
```

**CLI entry points are milestone deliverables, not commands assumed to exist on day one.** Prefer `uv run` to invoking a system-global Python. A possible later orchestrator is `uv run mmm-pipeline`; do not add one until useful. **A routine frontend build must never retrain a Bayesian model.**

## Repository layout

```text
bayesian-mmm-lab/
├── AGENTS.md
├── README.md
├── .gitignore
├── data/
│   ├── raw/                     # synthetic_mmm.csv (generated)
│   ├── processed/               # model_ready.csv (generated)
│   └── metadata/                # ground_truth.json and data dictionary
├── notebooks/
│   ├── 01_data_exploration.ipynb
│   ├── 02_bayesian_hierarchical_mmm.ipynb
│   └── 03_model_evaluation.ipynb
├── modeling/
│   ├── pyproject.toml
│   ├── uv.lock
│   ├── src/mmm_lab/
│   │   ├── __init__.py
│   │   ├── paths.py
│   │   ├── simulate.py
│   │   ├── preprocess.py
│   │   ├── model.py
│   │   ├── evaluate.py
│   │   ├── scenario.py
│   │   └── export.py
│   ├── artifacts/               # posterior and diagnostics (generated)
│   └── tests/
├── web/
│   ├── package.json
│   ├── package-lock.json
│   ├── vite.config.ts
│   ├── public/model-data/       # lightweight versioned exports
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── pages/
│   │   │   ├── Overview.tsx
│   │   │   ├── Decomposition.tsx
│   │   │   ├── Segments.tsx
│   │   │   └── Simulator.tsx
│   │   ├── lib/
│   │   ├── types/
│   │   └── tests/
│   └── index.html
├── worker/                       # optional, last phase only
│   ├── src/index.ts
│   └── wrangler.jsonc
└── .github/workflows/
    ├── ci.yml
    └── deploy.yml
```

Keep notebooks at the repository root but install and use the `mmm_lab` package from `modeling/`. Implement paths relative to the repository root through `paths.py`; **never rely on the current working directory or use a developer-specific absolute path**. Notebooks should import reusable package functions, not duplicate the core statistical implementation.

Generated large inference artifacts and temporary files should generally be gitignored. Commit compact synthetic fixtures, schemas, notebooks without huge outputs, necessary frontend data exports, and lockfiles according to the README's artifact policy.

## Statistical data contract

Generate a self-contained demonstration dataset with:

- **6 market segments**, **120 weekly periods**, and **3 promotional channels**: coupon, retailer promotion and digital advertising.
- Target: `sales_units` (observed weekly units by segment).
- Controls: `price_index`, `distribution_index`, `competitor_index`, `holiday`, and an interpretable seasonality/trend specification.
- Segment heterogeneity in baseline demand, promotional response and noise; deliberately weaker effective promotional information for some small segments.
- Channel spend that varies over time, including realistic correlation and overlapping campaigns, with explicit identification caveats.
- A known generating process containing lagged promotion effects (adstock) and diminishing marginal response (saturation).
- Fixed RNG seed, stable identifiers, predictable weekly timestamps, documented units, and nonnegative spend/count outcomes.

Output these files with a defined schema:

1. `data/raw/synthetic_mmm.csv`: observable data only.
2. `data/processed/model_ready.csv`: validated modeling table; fitted preprocessing parameters must come from training data only.
3. `data/metadata/ground_truth.json`: true parameters and component contributions (evaluation-only, **never supplied to model fitting**).
4. A data dictionary documenting variables, units, generation assumptions, and leakage risks.

Train on weeks **1–100** and hold out weeks **101–120** per segment. Preserve needed pre-holdout spend history for adstock. Time-varying predictors in the holdout must be clearly identified as known-in-advance inputs, realized exogenous inputs, or scenario assumptions; avoid calling conditional predictions unconditional forecasts.

Tests should verify fixed-seed regeneration, schema integrity, expected row counts, unique segment/week keys, finite values, valid ranges and reconstruction of the synthetic outcome from saved true components plus noise.

## Bayesian MMM requirements

Fit and compare **three real model specifications**:

1. **Complete pooling:** common channel-response coefficients across segments.
2. **No pooling:** independent segment-level response coefficients (with uncertainty made explicit).
3. **Partial pooling:** segment-specific coefficients governed by shared hierarchical hyperparameters; this is the centerpiece.

Use current, **version-pinned** PyMC-Marketing/PyMC/ArviZ APIs. Before implementing, verify that the installed PyMC-Marketing version supports the required hierarchical parameterization and transformations. If an extension requires lower-level PyMC, implement that part transparently, document the reason, and keep it compatible with the same export contract. Do not invent undocumented API methods.

Start with shared adstock and saturation shapes across segments unless sufficient information supports more complex hierarchy. Specify priors and parameter constraints, with numerical scaling that makes inference stable. Choose likelihood and link consistent with the data-generating process; document any deliberate modeling approximation. Preserve explicit definitions of baseline, channel contributions and residuals.

**Avoid causal overclaiming:** decomposed promotional contributions are model-based, assumption-dependent estimates. Neither posterior certainty nor forecasting accuracy alone proves promotional incrementality. Discuss omitted variables, selection effects, correlated campaigns, and sensitivity to alternative assumptions.

### Notebook deliverables

- `01_data_exploration.ipynb`: data distributions, seasonality, segment characteristics, spend correlations, target quality checks, train/holdout split.
- `02_bayesian_hierarchical_mmm.ipynb`: clearly annotated model equations, priors, prior predictive checks, sampling, trace and posterior summaries; save reproducible inference artifacts.
- `03_model_evaluation.ipynb`: convergence, posterior predictive checks, holdout accuracy and bias, posterior interval coverage, ground-truth parameter/contribution recovery, and the comparison among pooling strategies.

Include R-hat, effective sample sizes and divergent transition counts. Aim for R-hat near/below 1.01 on key parameters and no unresolved divergences; these thresholds alone do not guarantee validity. Do not silently report a failed recovery check as success. If there are weakly identified parameters, make them visible and explain the limitation.

## Export contract: Python → TypeScript

The website reads **versioned exports from actual fitted models**. Build `export.py` to write:

| File | Contents |
|---|---|
| `manifest.json` | export schema version, model/data hashes, train/holdout dates, segment/channel labels, units, timestamp, limitation labels |
| `overview.json` | observed sales, posterior predictive/fitted summaries, holdout metrics, time periods |
| `contributions.json` | baseline and channel contributions by segment/week, posterior summaries and residual reconciliation |
| `segments.json` | three pooling-model effect summaries, intervals, synthetic ground truth, recovery diagnostics |
| `simulator.json` | compact matched posterior draws, transformations, adstock history, baseline plan, valid spend ranges and scenario metadata |

The full posterior need not be shipped to the browser; export a bounded reproducible subset of **jointly indexed** draws, keeping correlations intact.

Define matching TypeScript types and runtime schema validation. Prevent `NaN`, infinity, missing-unit confusion, mismatched segment keys, and model-version mismatches.

**Posterior aggregation rule:** for totals, add components **within each posterior draw first**, then calculate means/quantiles; do not add separate interval endpoints. Distinguish parameter credible intervals from future-observation predictive intervals.

## Web app specification

Create an independent professional analytics design. Do not copy the healthcare dashboard's visual design or component structure. Label the demo prominently **Synthetic data · illustrative results**.

### Page 1 — Overview

- Segment and date-range filters; stable global filter state where appropriate.
- Observed sales versus fitted/predicted sales with uncertainty bands.
- Training versus holdout boundary, metrics with clear definitions and units.
- Marketing spend mix and a concise model summary.
- No static illustrative KPIs in the final implementation.

### Page 2 — Decomposition

- Modeled baseline demand and promotional channel contributions by week/period.
- Select segments, dates and channels; chart contribution uncertainty.
- Clarify that predicted mean and observed sales differ by residual noise.
- Reconcile totals to the model's fitted expected outcome.

### Page 3 — Segment Comparison & Partial Pooling

- Compare complete/no/partial pooling **using three fitted specifications**, not a hardcoded animation.
- Plot estimates and posterior intervals for each segment × promotional channel.
- Show true simulation coefficients and informative-sample differences, with an explanation of shrinkage and its bias/variance tradeoff.
- Permit examination of weak-data segments and cases where pooling is not beneficial.

### Page 4 — Decision Simulator

- Choose a segment and a **12-week** horizon; change spend for three channels.
- Compare to an explicitly defined baseline 12-week plan.
- For each selected posterior draw, recalculate **the exact fitted adstock and saturation transformations** using prior spend history and the proposed plan.
- Calculate the distribution of the scenario-minus-baseline expected sales **draw by draw**; display mean/median, interval and change in spend.
- Start with fixed weekly spend patterns and explicit channel limits; warn on extrapolation beyond observed spend support.
- Add fixed-budget optimization **after** the manual simulator passes parity tests; initially maximize expected incremental sales, not an undefined ROI/profit metric.
- Do not run MCMC in the browser or use arbitrary uplift multipliers.

### Frontend engineering

- React + TypeScript + Vite, Plotly.js (or justified equivalent), responsive accessible UI.
- Clear loading/error/empty states and clear units/labels/tooltips.
- Avoid loading oversized inference files; prefer compact exported records.
- Static deployment compatible with GitHub Pages, with `base: '/bayesian-mmm-lab/'` or documented environment override; use hash routing or a proven static-route fallback.
- Use `npm run typecheck`, `npm test`, and `npm run build` in CI.

## Scenario parity and optimization quality checks

Implement the scenario computation in Python first (`scenario.py`) and port the same transformations/parameterization to TypeScript (`web/src/lib/scenario.ts`).

Tests must include:

1. Unchanged plan yields **zero** scenario-minus-baseline incremental expected sales for all posterior draws within floating-point tolerance.
2. Python and TypeScript results agree for selected deterministic fixture scenarios within a specified tolerance.
3. Adstock correctly includes pre-scenario spending history.
4. Budget/channel constraints are enforced and infeasible cases show useful errors.
5. For a nonnegative, monotone response model with other inputs fixed, increasing valid spend cannot reduce that channel's modeled contribution; if the fitted specification permits non-monotonicity, document and test its behavior instead.
6. Scenario uncertainty uses common posterior draws for the baseline and alternative plan (not independently sampled draws).
7. The optimizer's output is feasible and no worse than the supplied feasible baseline under its defined objective, within numerical tolerance.

## GitHub Actions and deployment

- `ci.yml`: set up Python/uv and Node/npm; run deterministic lightweight Python tests, frontend typechecking, unit tests and build.
- **Do not fit a full MCMC model on each push.** Use pinned compact fixtures or pre-generated, validated exports for ordinary CI; run expensive modeling only through an explicit local or manual workflow.
- `deploy.yml`: deploy `web/dist/` to GitHub Pages when permitted; preserve `/bayesian-mmm-lab/` asset paths and direct-route behavior.
- No build may depend on personal absolute paths, private services, or Cloudflare secrets.
- Never claim a public URL is live until the deployment has been verified.

## Cloudflare Workers AI — optional final milestone only

Do not build this before the notebook, exports, all four pages, scenario engine and GitHub Pages deployment work.

If later authorized, add a Worker that answers questions using **approved structured model outputs**. The assistant may explain estimates, uncertainty, partial pooling, and scenario comparisons, but must not fabricate model numbers, independently calculate effects, or assert causality.

Keep API secrets on the Worker side. Implement origin allowlisting, validation, abuse controls/rate limits, timeouts and safe fallback text. No confidential data or clinical predictions.

## Milestones and acceptance gates

### M1 — Repository foundation
- Create layout, `AGENTS.md`, README, `.gitignore`, `modeling/pyproject.toml`, `uv.lock`, frontend tooling and lockfile, and initial CI.
- `uv sync`, `npm ci`, `npm run build` succeed; basic tests execute.
- **Stop:** no synthetic data generation or model fitting yet.

### M2 — Synthetic data
- Implement generator and data dictionary; create exploration notebook.
- Pass reproducibility, schema, key uniqueness and true-component reconstruction tests.
- **Stop:** no Bayesian model fitting yet.

### M3 — Fitted models and statistical evaluation
- Implement complete/no/partial pooling models, notebooks, diagnostics and explicit held-out evaluation.
- Save inference artifacts; explain any weak identification or failed recovery.
- **Stop:** no dashboard charts yet.

### M4 — Versioned model exports
- Export all frontend JSON and TypeScript types/schemas.
- Pass numeric reconciliation, posterior aggregation and version-consistency tests.
- **Stop:** no interactive dashboard yet.

### M5 — Analytical pages
- Build Overview, Decomposition, and Segment Comparison with genuine data exports.
- Check filters, intervals, legends, responsiveness, error states and Python metric parity.
- **Stop:** no decision simulator yet.

### M6 — Decision simulator
- Implement 12-week posterior scenarios, history-aware adstock, valid spending constraints, Python/TypeScript parity and optional fixed-budget optimization.
- Verify zero-change behavior, constraints and repeatability.

### M7 — GitHub Pages release
- Build/test/review the app; configure authorized deployment and verify actual site functionality.
- Remove all placeholder metrics and disclose synthetic data/model limitations.

### M8 — Optional Cloudflare AI
- Only after M7, and only when explicitly requested.
- Implement grounded explanations, restricted prompts, tests and security controls.

## Definition of done

A milestone is done only when its code and tests exist, commands and results have been documented, outputs are reproducible, statistical labels are accurate, and no knowingly misleading placeholder results remain in the delivered functionality. Stop at the milestone boundary and report what remains.
