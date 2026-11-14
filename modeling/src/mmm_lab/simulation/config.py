"""Fixed defaults and small-test scale for source simulation."""

from dataclasses import dataclass


SEGMENT_STATES = {
    "northeast": ("NY", "MA", "PA"),
    "southeast": ("FL", "GA", "NC"),
    "great_lakes": ("IL", "OH", "MI"),
    "south_central": ("TX", "OK", "LA"),
    "mountain_west": ("CO", "UT", "NM"),
    "pacific_coast": ("CA", "OR", "WA"),
}
STORE_COUNTS = {
    "northeast": 50, "southeast": 40, "great_lakes": 35,
    "south_central": 30, "mountain_west": 20, "pacific_coast": 15,
}
CHANNELS = ("coupon", "retailer_promotion", "digital")
BASELINES = {
    "northeast": 1200, "southeast": 980, "great_lakes": 760,
    "south_central": 540, "mountain_west": 310, "pacific_coast": 180,
}
SPEND_SCALES = {
    "northeast": 1.0, "southeast": 0.82, "great_lakes": 0.65,
    "south_central": 0.45, "mountain_west": 0.22, "pacific_coast": 0.12,
}
NOISE_SIGMAS = {
    "northeast": 45.0, "southeast": 48.0, "great_lakes": 46.0,
    "south_central": 43.0, "mountain_west": 48.0, "pacific_coast": 55.0,
}
MAX_EFFECTS = {
    "northeast": (180.0, 145.0, 115.0),
    "southeast": (145.0, 120.0, 100.0),
    "great_lakes": (130.0, 105.0, 90.0),
    "south_central": (105.0, 95.0, 75.0),
    "mountain_west": (80.0, 70.0, 65.0),
    "pacific_coast": (65.0, 55.0, 50.0),
}
ADSTOCK_DECAY = dict(zip(CHANNELS, (0.25, 0.45, 0.65)))
HALF_SATURATION = dict(zip(CHANNELS, (2800.0, 3300.0, 3500.0)))


@dataclass(frozen=True)
class SimulationConfig:
    seed: int = 20261113
    weeks: int = 120
    start_date: str = "2023-01-02"
    unit_scale: float = 1.0

    def __post_init__(self) -> None:
        if not 1 <= self.weeks <= 120:
            raise ValueError("weeks must be between 1 and 120")
        if not 0 < self.unit_scale <= 1:
            raise ValueError("unit_scale must be in (0, 1]")
