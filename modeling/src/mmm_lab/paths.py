"""Repository paths independent of the caller's working directory."""

from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = REPOSITORY_ROOT / "data"
SILVER_DIR = DATA_DIR / "silver"
AUXILIARY_DIR = DATA_DIR / "auxiliary"
MARTS_DIR = DATA_DIR / "marts"
RAW_DATA_DIR = DATA_DIR / "raw"
PROCESSED_DATA_DIR = DATA_DIR / "processed"
METADATA_DIR = DATA_DIR / "metadata"
ARTIFACTS_DIR = REPOSITORY_ROOT / "modeling" / "artifacts"
WEB_MODEL_DATA_DIR = REPOSITORY_ROOT / "web" / "public" / "model-data"
