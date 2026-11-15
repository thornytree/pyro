"""Step 2 of the training bundle: harmonized FIRMS detections -> cell x day counts.

Run from apps/inference:

    python -m harmonization.firms_cells ../../data/firms_harmonized ../../data/training/firms_cell_day

Writes `<output>/<SOURCE>/<year>.csv.gz`, one row per (date, cell, sensor)
that had at least one detection. It mirrors the input layout and skips files
that already exist, so it can be stopped and rerun (`--force` redoes them).

`date` is the local solar date at the detection (UTC time shifted by
longitude / 15 hours), so an afternoon pass and the same evening's pass land
on one day, as they do in Daymet and in Open-Meteo's local-time daily values.
Because of that shift, a few rows in `<year>` files carry 31 December of the
previous year; sum over files when reading (training_sample.py does).

Fire counts use vegetation fires only (archive `type` 0, or no type: NRT and
Landsat). Volcano, static-source and offshore rows are counted in `n_nonfire`.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from shared import firms_schema as schema
from shared import grid

KEY = ["date", "cell_row", "cell_col", "source"]
USECOLS = ["source", "acq_datetime", "daynight", "longitude", "x", "y", "frp", "confidence", "type"]


def cell_day_counts(detections: pd.DataFrame) -> pd.DataFrame:
    """Detections in the unified schema -> one row per (date, cell, sensor)."""
    row, col = grid.cell_index(detections["x"], detections["y"])
    utc = pd.to_datetime(detections["acq_datetime"], utc=True).dt.tz_localize(None)
    local = utc + pd.to_timedelta(detections["longitude"].to_numpy() * 240.0, unit="s")
    kind = detections["type"].to_numpy(dtype="float64", na_value=np.nan)
    fire = np.isnan(kind) | (kind == schema.TYPE_VEGETATION_FIRE)
    frp = detections["frp"].to_numpy(dtype="float64", na_value=np.nan)
    frame = pd.DataFrame({
        "date": local.dt.strftime("%Y-%m-%d").to_numpy(),
        "cell_row": row,
        "cell_col": col,
        "source": detections["source"].astype(str).to_numpy(),
        "n_fire": fire.astype("int32"),
        "n_fire_high": (fire & (detections["confidence"].to_numpy(dtype="float64", na_value=np.nan)
                                == schema.CONFIDENCE_HIGH)).astype("int32"),
        "n_fire_day": (fire & (detections["daynight"].astype(str).to_numpy() == "D")).astype("int32"),
        "frp_sum": np.where(fire, frp, np.nan),
        "frp_max": np.where(fire, frp, np.nan),
        "n_nonfire": (~fire).astype("int32"),
    })
    frame = frame[frame["cell_row"] >= 0]
    out = frame.groupby(KEY, sort=True).agg(
        n_fire=("n_fire", "sum"), n_fire_high=("n_fire_high", "sum"),
        n_fire_day=("n_fire_day", "sum"),
        frp_sum=("frp_sum", lambda s: s.sum(min_count=1)), frp_max=("frp_max", "max"),
        n_nonfire=("n_nonfire", "sum"),
    ).reset_index()
    return out


def _read(path: Path) -> pd.DataFrame:
    if path.suffix == ".parquet":
        return pd.read_parquet(path, columns=USECOLS)
    return pd.read_csv(path, usecols=USECOLS, dtype={"source": str, "daynight": str})


def run(input_dir: Path, output_dir: Path, force: bool = False) -> None:
    for source in schema.SOURCES:
        for path in sorted((input_dir / source).glob("*.*")):
            year = path.name.split(".")[0]
            target = output_dir / source / f"{year}.csv.gz"
            if target.exists() and not force:
                continue
            counts = cell_day_counts(_read(path))
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_name(target.name + ".part")
            counts.to_csv(tmp, index=False, float_format="%.2f",
                          compression={"method": "gzip", "compresslevel": 4})
            tmp.replace(target)
            print(f"{source} {year}: {len(counts):,} cell-days", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("input_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    run(args.input_dir, args.output_dir, args.force)


if __name__ == "__main__":
    main()
