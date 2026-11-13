
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
# Bayesian MMM Lab

Project scaffold for a Bayesian marketing mix modeling lab. The data files, model artifact, notebooks, application code, and workflows are placeholders; no simulation, model fit, or deployment has been run yet.

## Layout

- `data/`: raw and processed data plus simulation metadata
- `notebooks/`: exploration, modeling, and evaluation notebooks
- `modeling/`: Python package, tests, and model artifacts
- `web/`: Vite web application and exported model data
- `worker/`: Cloudflare Worker
- `.github/workflows/`: CI and deployment workflows
