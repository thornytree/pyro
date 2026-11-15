"""Feature lists and artifact locations shared by training and inference.

Model 1 (occurrence) is trained only on inputs the live `dataBundle` can
supply, so the same columns exist at serving time. Left out of the compiled
table for that reason: Daymet (training-only, decision 1; it lags by a year),
soil moisture and the 6-day weather history (not in the live bundle), `year`
and `firms_sensors_active` (they shift between the date-split subsets) and
`om_elevation` (duplicates `topo_elev_mean`).
"""
from __future__ import annotations

import os
from pathlib import Path

SEASON = ["latitude", "longitude", "doy_sin", "doy_cos"]
FIRE_HISTORY = [
    "firms_fire_days_prev1d", "firms_fire_days_prev7d", "firms_fire_days_prev30d",
    "firms_fire_days_prev365d", "firms_days_since_fire",
    "firms_neighbour_fire_days_prev1d", "firms_neighbour_fire_days_prev7d",
]
WEATHER = [
    "om_temp_max", "om_temp_min", "om_temp_mean", "om_rh_min", "om_rh_mean",
    "om_vpd_max", "om_vpd_mean", "om_precip_sum", "om_wind_max", "om_wind_mean",
    "om_gust_max", "om_wind_from_sin", "om_wind_from_cos",
]
TOPOGRAPHY = [
    "topo_elev_mean", "topo_elev_std", "topo_slope_mean", "topo_slope_p90",
    "topo_northness", "topo_eastness", "topo_flat_frac",
]
OCCURRENCE_FEATURES = [*SEASON, *FIRE_HISTORY, *WEATHER, *TOPOGRAPHY]

# Model 2a: one row per (burning 10 km cell, day, target cell).
SPREAD_FEATURES = [
    "adjacent", "diagonal",
    "src_n_fire", "src_n_high", "src_frp_max", "src_n_sensors",
    "src_fire_days_prev7d", "src_burning_neighbours",
    "tgt_fire_days_prev7d", "tgt_fire_days_prev365d",
    "latitude", "longitude", "doy_sin", "doy_cos",
]

OCCURRENCE_FILE = "occurrence.joblib"
SPREAD_FILE = "spread.joblib"
FIRE_DAYS_FILE = "fire_days.npy"


def model_dir(data_dir: Path | None = None) -> Path:
    """Where artifacts live: PYRO_MODEL_DIR, else <data>/models (gitignored)."""
    if os.environ.get("PYRO_MODEL_DIR"):
        return Path(os.environ["PYRO_MODEL_DIR"])
    data = data_dir or Path(os.environ.get("PYRO_DATA_DIR", Path(__file__).resolve().parents[3] / "data"))
    return Path(data) / "models"
