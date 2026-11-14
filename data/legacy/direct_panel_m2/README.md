# Archived direct-panel M2

The previous M2 generated a 720-row MMM panel directly. The source-driven
architecture in `docs/CODEX_PROMPTS.md` supersedes that route. These copies
preserve the earlier raw/processed CSVs, metadata, generator/preprocessor,
tests, and notebook. `archive_manifest.json` records original relative
paths, file sizes, and SHA256 checksums. The archive is for historical review
only; it is not an input to the new source generator or future ETL.

The active direct-panel CSVs and their generator/preprocessor were retired
after verified archival. The active `notebooks/01_data_exploration.ipynb` is a
short M2B placeholder; its previous version is archived here. M2B will build
a new analytical panel from the M2A Parquet sources.
