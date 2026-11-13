from mmm_lab.paths import (
    ARTIFACTS_DIR,
    DATA_DIR,
    REPOSITORY_ROOT,
    WEB_MODEL_DATA_DIR,
)


def test_repository_paths_are_anchored_to_package_location():
    assert (REPOSITORY_ROOT / "AGENTS.md").is_file()
    assert DATA_DIR == REPOSITORY_ROOT / "data"
    assert ARTIFACTS_DIR == REPOSITORY_ROOT / "modeling" / "artifacts"
    assert WEB_MODEL_DATA_DIR == REPOSITORY_ROOT / "web" / "public" / "model-data"
