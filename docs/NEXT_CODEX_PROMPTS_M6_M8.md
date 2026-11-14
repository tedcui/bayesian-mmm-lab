# Bayesian MMM Decision Lab — Codex Tasks After M5

Based on the M5 README snapshot provided November 14, 2026. Existing work: source-driven M2A/M2B, three real PyMC models in M3, versioned browser exports in M4, and the Overview, Decomposition, and Segment Comparison app in M5.

**Implementation sequence:** M6A → M6B → M7 → optional M8. M6A and M6B are two reviewable subtasks of the existing M6 milestone, not new replacements for M1–M5.

## M6A — Reference scenario engine and Python/TypeScript parity

```text
Read AGENTS.md and docs/MODEL_SPECIFICATION.md, docs/MODELING_DATA_CONTRACT.md, docs/EXPORT_CONTRACT.md, docs/CODEX_PROMPTS.md, and the current README. Inspect M3 model code, the actual M4 simulator.json schema, and M5 data loading code before editing.

Implement M6A only: a mathematically faithful posterior-based scenario engine in Python and TypeScript. Do NOT build the simulator page or optimizer in this task.

Known state:
- 6 geography-defined business regions, 3 PLANNED marketing channels (coupon, retailer promotion, digital), 120 weeks; training weeks 1–100 and holdout weeks 101–120.
- M3 uses a Normal likelihood, channel-level geometric adstock and Hill saturation, controls, and 3 pooling variants; the primary export is partial pooling.
- M4 simulator.json has 96 jointly indexed partial-pooling posterior draws, 12-week holdout replay inputs, fixed controls, pre-horizon spend history, fitted transformation parameters, and spend support bounds.
- The exported holdout is a CONDITIONAL HISTORICAL REPLAY, not a future forecast or experimentally established causal result.

Requirements:
1. Implement reusable Python reference calculations in modeling/src/mmm_lab/scenario.py, using the exact M3 equations and scaling/transformation conventions. Add a CLI or fixture-generation entry point only if appropriate for the existing package conventions.
2. Implement corresponding pure TypeScript functions in web/src/lib/scenario.ts. Reuse existing runtime-validated M4 types, manifests, and loaders. Do not duplicate or bypass current schema/hash validation.
3. Inputs: one region; 12-week baseline planned-spend schedule; an alternative planned-spend schedule; the matched 96 posterior draws; fixed non-marketing inputs; pre-horizon channel spend history. Explicitly define units and whether UI controls will scale each channel's existing 12-week weekly pattern.
4. For each posterior draw, compute BOTH baseline and alternative expected outcomes with identical non-marketing inputs. Recompute geometric adstock across the complete historical + replay window, then Hill saturation and segment-specific channel responses. Difference the expected outcomes within the SAME draw before summarizing. Carry forward the exact pre-horizon spend state.
5. Preserve matching draws of coefficients, hyperparameters, adstock, saturation, baselines, and controls. Do not independently draw or average coefficients before simulation. Do not retrain the model or run MCMC in browser.
6. Return for each scenario: posterior expected-unit totals, paired incremental units, mean/median and central 90% credible interval, per-channel difference, baseline and alternate 12-week total planned spend, and extrapolation/support flags. Clearly separate parameter uncertainty from observation predictive uncertainty.
7. The spend input is the separately simulated PLANNED marketing budget, not redeemed discounts from transaction records.
8. Create deterministic test fixtures from selected genuine exported posterior draws. Check Python/TypeScript parity for per-draw totals and summaries with explicit absolute/relative numeric tolerances and documented rounding behavior.
9. Test no-change scenario zero-difference draw-by-draw; all-zero prospective spend with historical carryover; changed individual channels; segment isolation; source/version mismatch; bounds; invalid numbers; missing history; and repeatable evaluations.
10. Verify baseline replay reconstructs the M4/M3 reference expected outcomes (within documented tolerance). If export information is insufficient to reproduce the fitted transformation precisely, improve the M4 exporter/schema, regenerate files, update its contract, and rerun the relevant validations. Never insert placeholder coefficients or a substitute response function.
11. Add efficient, memoizable pure functions suitable for browser use; avoid giant copies and avoid recalculation unrelated to changed controls.
12. Preserve M1–M5 behavior and do not introduce source/ground-truth leakage.

Run Python pytest and frontend typecheck/tests/build with the repo's pinned lockfiles. On Windows PowerShell use npm.cmd if necessary. Report numerical parity, baseline reconciliation, files changed, test results, limitations, and exact next step. STOP after M6A.
```

**Gate:** No M6B until paired per-draw parity, baseline reproduction, and reset-to-baseline tests pass.

## M6B — Decision simulator UI and fixed-budget optimization

```text
Read AGENTS.md and verify the passed M6A parity fixtures and M4 export contract. Implement M6B only, building on the tested scenario engine. Do not replace it with approximate curves or client-side hardcoded uplifts.

1. Add a Simulator page to existing M5 static-compatible navigation, design system, and shared model-data loader. Keep Overview, Decomposition, and Segment Comparison unchanged unless fixing a proven issue.
2. Use the 12-week conditional historical replay. Make it unmistakable in the UI that scenarios replay fitted model responses under held-fixed controls; they are not ex-ante forecasts.
3. Provide region selection; one baseline spend schedule; coupon, retailer-promotion, and digital spending controls; reset; baseline-vs-alternative comparison; and total planned 12-week spend. Default each control to 100% of its exported weekly plan (or another documented mapping consistent with the export). Changing a channel should scale its original weekly pattern, not accidentally multiply a 12-week total by 12.
4. Show posterior mean and 90% credible interval for model-implied incremental expected units, baseline/alternative expected units, spend delta, and channel-specific response changes. Use paired posterior draws for differences. Label any draw-subset approximations (96 joint draws).
5. Add an easy-to-understand scenario chart and a clear explanation of adstock, saturation, and uncertainty. Distinguish modeled contribution from causally identified lift. Show extrapolation warnings when proposed spending exceeds observed support, and either disallow or explicitly flag unacceptable ranges.
6. After manual scenarios and UI tests pass, add a FIXED-TOTAL-BUDGET optimizer subject to spend support and minimum/maximum caps. Define the budget in absolute dollars over the entire 12-week horizon. For each candidate allocation, use exactly the same tested scenario engine and paired posterior draws. Optimize mean modeled incremental expected UNITS (not profit or ROI). Preserve a fixed baseline weekly profile per channel and document how channel-total allocation maps into weekly values.
7. Report optimizer feasibility, boundary solutions, and any inability to allocate a requested budget within bounds. Never claim global optimality unless verified. Include comparison to current baseline allocation and a prominent assumption note.
8. Do not imply partial pooling is definitively the best-effect-recovery model: M3 reported 15/18 90% coefficient truth coverage for partial pooling versus 17/18 for no pooling. Make this limitation visible where educational context requires it.
9. Provide empty/error/loading states, responsive charts, accessible controls, and deterministic tests for reset, changing one channel, budget accounting, optimizer feasibility, warnings, and Python/TypeScript parity integration.
10. Update README and relevant docs with the exact simulator assumptions, provenance, mathematical formula, validation, supported spend ranges, and operating instructions. Do not create a Makefile or trigger MCMC during normal web builds.

Run Python pytest, frontend typecheck/tests, and production build. Summarize changes and numerical validation; STOP after M6B / completed M6.
```

**Gate:** No M7 until slider outputs reconcile with the Python reference; unchanged spend returns zero incremental units; 12-week spend totals are correct; and optimization never breaks constraints.

## M7 — Production hardening and GitHub Pages preparation

```text
Read AGENTS.md, current README and docs, and inspect the complete M1–M6 deliverables. Implement M7 only.

1. Re-run lightweight Python checks (uv run --locked pytest -q from modeling), frontend checks (npm ci; npm run typecheck; npm test; npm run build from web), and schema/export checks. Include scenario parity fixtures in CI. Do not rerun expensive full MCMC fitting in routine CI or build workflows.
2. Check that all public model-data files and the built site contain only approved aggregate synthetic outputs. No row-level operational transactions, contact/loyalty identifiers, full NetCDF posterior, credentials, or sensitive internal metadata.
3. Audit repository contents for organization-specific table names and copied real-source schema/metadata. The project may describe realistic source-to-mart structure, but before public release identify anything that should be anonymized and propose a safe public alternative. Do not silently alter the original source contract.
4. Confirm existing hash-router navigation works when hosted in a repository subpath. Configure Vite base '/bayesian-mmm-lab/' for the intended GitHub Pages project URL; verify asset paths and model-data fetches under that base.
5. Update GitHub Actions CI for locked Python/frontend tests and add a separate Pages deployment workflow for the static web/dist artifact. It should use committed, checksum-validated M4 exports and NEVER retrain the PyMC models automatically.
6. Check chart performance and data bundle size (current M4 payloads total approximately 1.5MB uncompressed), mobile layouts, keyboard accessibility, screen reader labels, loading errors, and visual consistency across all four pages.
7. Add persistent disclosures: synthetic data, conditional 12-week replay (not prospective forecast), model-based channel contributions (not experimentally identified causality), and partial-pooling recovery limitations. Clarify 90% credible versus predictive intervals wherever relevant.
8. Update README with source/ETL lineage, reproducible CLI sequence, local site instructions, simulator assumptions and tests, no-Makefile tooling, hosting setup, and public-demo navigation.
9. Build and inspect dist/ locally; document the exact GitHub repository settings and deployment authorization steps. DO NOT push to remote, publish, or enable deployment without explicit user authorization. If authorization exists, deploy and verify the real site, otherwise STOP with an approval-ready checklist.

Report commands, pass/fail status, security/privacy findings, build size, proposed GitHub Actions changes, and remaining release actions. STOP after M7.
```

**Gate:** If the repository is intended to be public, explicitly approve the sanitized source-contract metadata before pushing.

## M8 — Optional grounded explanation assistant with Cloudflare Workers AI

```text
Read AGENTS.md and verify that the core four-page application is independently useful without AI. Implement optional M8 only. Do not copy any healthcare-dashboard code or UI.

1. Create a standalone Cloudflare Worker under worker/ with a pinned configuration and documented local testing. Use Cloudflare Workers AI through its current supported binding/API, confirmed against current documentation before coding.
2. Add a small optional assistant to the existing React app for explaining validated model outputs, partial pooling, uncertainty, decomposition, and the active spending scenario.
3. Ground every quantitative answer in approved, versioned M4 export summaries or a validated structured M6 scenario context. Validate incoming version IDs, region/channel identifiers, scenario controls, numeric values, payload size, and query length. Treat arbitrary user text as untrusted.
4. Prefer retrieving/verifying authoritative model summaries by model/version rather than trusting freely supplied client-side metrics. For scenario-specific answers, communicate clearly that calculations originate from the validated browser scenario engine; do not make the LLM recalculate forecasts.
5. Do not provide access to source transaction records, client-specific metadata, evaluation-only hidden ground truth, secrets, or unpublished modeling artifacts.
6. Never fabricate coefficients, credible intervals, causal claims, or recommendations. Explain that 12-week scenarios are conditional historical replays. Answer numerical questions with validated values and units, or say insufficient information.
7. Implement narrow CORS, input validation, rate limits/quotas, secret management only in Worker bindings, safe output handling, timeouts, and deterministic fallback when AI is unavailable.
8. Add tests for valid answers, malformed requests, version mismatch, invented-number prevention, prompt injection attempts, ungrounded causal claims, origin restrictions, and failure paths.
9. Keep all primary pages and simulator functional if the Worker is not configured or offline. Do not deploy Worker or expose API keys without explicit authorization.

Run tests and build, document setup/cost/rate-limit assumptions and remaining deployment steps, report results, and STOP after M8.
```

## Final interview-readiness check (after M7; optional)

Prepare a 5-minute live flow: (1) Overview—source-to-mart and model fit, (2) Segment Comparison—partial pooling and the important no-pooling comparison, (3) Decomposition—model-based contributions with caveats, and (4) Simulator—fixed-budget scenario, uncertainty, and decision implications. Prepare backup explanations for adstock, Hill saturation, posterior convergence, holdout-vs-causality, and the choice of simulated business regions. This is presentation preparation, not a new app milestone.
