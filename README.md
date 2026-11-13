
# Bayesian MMM Decision Lab

## Project objective

Build a production-quality portfolio web application demonstrating Bayesian hierarchical marketing mix modeling using reproducible synthetic data.

The application must visualize genuine fitted model outputs, compare pooling strategies, and run valid posterior-based marketing spend scenarios.

## Architecture

- Python modeling package with PyMC-Marketing/PyMC
- Jupyter notebooks for exploration, estimation, and evaluation
- React + TypeScript + Vite frontend
- Plotly.js for interactive statistical visualizations
- Static model exports in JSON
- GitHub Pages hosting
- Cloudflare Workers AI integration only in the final phase

## Development rules

1. Work on one milestone at a time.
2. Do not create fake model results or hardcode dashboard metrics.
3. Build reusable Python functions; notebooks should import them.
4. Use synthetic data with a fixed seed and save the true generating parameters.
5. Implement real hierarchical partial pooling.
6. Fit separate full-pooling and no-pooling baselines.
7. Validate before exporting model data.
8. Preserve units and posterior uncertainty.
9. All scenario calculations must derive from the fitted model.
10. Verify the current installed library API before implementing.
11. Add tests for data generation, transformations, exports, and scenario parity.
12. Never include client-confidential or real healthcare data.
13. Commit completed milestones with meaningful commit messages.
14. Do not start the next milestone until the current one passes its acceptance checks.

## Statistical requirements

- Segment-specific promotional response parameters
- Shared hierarchical hyperparameters
- Seasonality and appropriate controls
- Adstock and saturation
- Prior and posterior predictive checks
- Convergence diagnostics
- Temporal holdout evaluation
- Parameter recovery using synthetic ground truth
- Comparison of full, no, and partial pooling
- Explicit uncertainty in charts and decisions

## UI requirements

Create independent pages:

1. Overview
2. Decomposition
3. Segment Comparison & Partial Pooling
4. Decision Simulator

The app must be responsive, readable, and suitable for technical interviews.

Display a clear "Synthetic Data" indicator.

## Definition of done

A milestone is complete only when:

- Its required files exist
- Relevant tests pass
- Outputs are reproducible
- Documentation is updated
- The application or notebook can be executed locally
- No placeholder statistical metrics remain in production views
# Bayesian MMM Decision Lab

M1 repository foundation for a synthetic-data Bayesian marketing mix modeling demonstration. The React screen is a setup placeholder. There are no generated observations, fitted models, diagnostics, or exported metrics yet.

## Requirements

- Python 3.12 and [uv](https://docs.astral.sh/uv/)
- Node.js 24 and npm

On Windows PowerShell with script execution disabled, use `npm.cmd` in place of `npm`.

## Local setup

From `modeling/`:

```sh
uv sync --locked
uv run --locked pytest
```

From `web/`:

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run build
npm run preview
```

The Vite build uses `/bayesian-mmm-lab/` as its GitHub Pages base path. The frontend build reads static assets only; it does not run Python or fit a model. `ci.yml` runs Python and frontend checks on pushes and pull requests. Deployment remains disabled until the release milestone.

## Repository and artifact policy

`modeling/src/mmm_lab/` is the installable Python package. `paths.py` resolves repository paths from the package location, independent of the caller's working directory. Root-level notebooks will use this package in later milestones. `web/` contains the React/TypeScript/Vite shell. `worker/` is reserved for the optional final phase.

The `data/`, `modeling/artifacts/`, and `web/public/model-data/` directories contain only `.gitkeep` files in M1. Later milestones will generate and validate their contents. Keep compact synthetic datasets, metadata, versioned frontend exports, notebooks without large outputs, and both lockfiles in Git. Ignore large posterior NetCDF files, local environments, caches, and build output. Ground truth is reserved for evaluation and must never become a model feature.

## M1 verification (2026-11-13)

| Command | Result |
|---|---|
| `uv sync --locked` | Passed with Python 3.12.13; 7 packages resolved |
| `uv run --locked pytest -q` | Passed; 1 test |
| `npm ci` | Passed; 44 packages installed from lockfile |
| `npm run typecheck` | Passed |
| `npm test` | Passed; 1 test |
| `npm run build` | Passed; Vite production output created in `web/dist/` |

The first frontend typecheck found a missing Vite CSS type declaration. Adding Vite client types to `tsconfig.json` resolved it; the table records the successful rerun. Local checks do not verify the hosted GitHub Actions runner or deployment.

## Next milestone

M2 generates the deterministic synthetic dataset, data dictionary, and exploration notebook, with schema and reconstruction tests. Model fitting starts in M3.
