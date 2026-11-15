"""Every vegetation-fire cell-day in the FIRMS archive, one row per 10 km cell and day."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from harmonization.compile_dataset import KEY, day_number, pack


def read_fire_cell_days(cell_day_dir: Path) -> pd.DataFrame:
    """Sensors merged: detections, high-confidence detections, peak FRP, sensors that saw fire.

    Sorted by the packed (cell, day) `key`, which is what `fire_history` searches.
    """
    parts = []
    for path in sorted(Path(cell_day_dir).glob("*/*.csv.gz")):
        part = pd.read_csv(path, usecols=[*KEY, "n_fire", "n_fire_high", "frp_max"])
        part = part[part["n_fire"] > 0]
        parts.append(part.assign(day=day_number(part["date"])).drop(columns="date"))
    if not parts:
        raise FileNotFoundError(f"No FIRMS cell-day files under {cell_day_dir}")
    table = pd.concat(parts, ignore_index=True).groupby(["cell_row", "cell_col", "day"], sort=False).agg(
        n_fire=("n_fire", "sum"), n_high=("n_fire_high", "sum"),
        frp_max=("frp_max", "max"), n_sensors=("n_fire", "size")).reset_index()
    table["key"] = pack(table["cell_row"], table["cell_col"], table["day"])
    return table.sort_values("key", ignore_index=True)


def has_fire(fire_keys: np.ndarray, cell_row, cell_col, day) -> np.ndarray:
    """Whether each (cell, day) is in the sorted `fire_keys`."""
    key = pack(cell_row, cell_col, day)
    at = np.minimum(np.searchsorted(fire_keys, key), len(fire_keys) - 1)
    return fire_keys[at] == key
