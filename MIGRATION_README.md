# M2 Migration Guide — One-Time Instructions

## Decision

Do not continue into M3 using the old directly generated 720-row file. Preserve M1 and migrate M2 into two independently testable stages:

- **M2A:** simulate source-aligned transaction, store, product tables, plus clearly labeled independent campaign/context sources.
- **M2B:** ETL enrich, reconcile, group geography to segment, aggregate into 720 segment-week rows and make model-ready features.

The new source model is based on the user-provided source schema. The three original tables do **not** by themselves identify planned digital spend, competitor activity, or pre-outcome product availability, so the two auxiliary sources are proposed additions.

## How to install these specs

Copy:

```text
AGENTS.md                    -> repository root / AGENTS.md
docs/SOURCE_SCHEMA_AND_ETL.md -> repository root / docs/SOURCE_SCHEMA_AND_ETL.md
docs/MODELING_DATA_CONTRACT.md -> repository root / docs/MODELING_DATA_CONTRACT.md
docs/CODEX_PROMPTS.md       -> repository root / docs/CODEX_PROMPTS.md
```

Keep an optional backup of the previous AGENTS.md. Review source-schema names and internal-looking metadata before publicly publishing the repository. The website should contain synthetic, non-sensitive aggregate analytics only.

## Next prompt

Use **M2A** from `docs/CODEX_PROMPTS.md` first. After it passes, run **M2B**. Only then use M3.
