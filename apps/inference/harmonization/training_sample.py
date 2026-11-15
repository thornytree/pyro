"""Step 3 of the training bundle: choose the cell-days to train and test on.

Run from apps/inference, after harmonization.firms_cells:

    python -m harmonization.training_sample ../../data/training/firms_cell_day ../../data/training

Writes
  cells.csv.gz            every cell that ever had a vegetation-fire detection,
                          with its centre; the list the topography, Daymet and
                          weather fetchers work through
  sample/<year>.csv.gz    one row per sampled cell-day, FIRMS columns per sensor
  sample_summary.json     row counts

The sample is every cell-day with a vegetation-fire detection from any sensor,
plus `--background` times as many cell-days with no detection of any kind,
drawn at random from the same cells and the same year. Background rows are
"no sensor reported anything", not confirmed absence of fire.

Per-sensor columns are empty (not 0) on dates outside that sensor's archive,
so "sensor did not exist yet" cannot be read as "sensor saw nothing".

`split` is by time, never random: nearby cell-days are correlated, so a
random split would leak. Defaults: train to 2024, validation 2025, test 2026.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from shared import firms_schema as schema
from shared import grid

CELL = ["cell_row", "cell_col"]
KEY = ["date", *CELL]
SUMS = ["n_fire", "n_fire_high", "n_fire_day", "frp_sum", "n_nonfire"]


def read_counts(input_dir: Path) -> pd.DataFrame:
    """All (date, cell, sensor) rows, re-summed across the year files."""
    frames = [pd.read_csv(p) for p in sorted(input_dir.glob("*/*.csv.gz"))]
    counts = pd.concat(frames, ignore_index=True)
    groups = counts.groupby([*KEY, "source"], sort=False)
    out = groups[SUMS].sum(min_count=1)
    out["frp_max"] = groups["frp_max"].max()
    return out.reset_index()


def cell_table(fire_days: pd.DataFrame) -> pd.DataFrame:
    cells = fire_days.groupby(CELL).size().rename("n_fire_days").reset_index()
    x, y = grid.cell_centre(cells["cell_row"], cells["cell_col"])
    lat, lon = grid.from_albers(x, y)
    cells.insert(2, "cell_id", [grid.cell_id(r, c) for r, c in zip(cells["cell_row"], cells["cell_col"])])
    cells.insert(3, "tile_id", cells["cell_id"].str[:6])
    return cells.assign(x=x, y=y, latitude=lat.round(5), longitude=lon.round(5))


def background(cells: pd.DataFrame, taken: pd.MultiIndex, dates: pd.DatetimeIndex,
               n: int, rng: np.random.Generator) -> pd.DataFrame:
    """n cell-days from `cells` x `dates` that are not in `taken`."""
    picked = pd.DataFrame(columns=KEY)
    while len(picked) < n:
        draw = int((n - len(picked)) * 1.2) + 100
        which = rng.integers(0, len(cells), draw)
        cand = pd.DataFrame({
            "date": dates[rng.integers(0, len(dates), draw)].strftime("%Y-%m-%d"),
            "cell_row": cells["cell_row"].to_numpy()[which],
            "cell_col": cells["cell_col"].to_numpy()[which],
        })
        cand = cand[~pd.MultiIndex.from_frame(cand).isin(taken)]
        picked = pd.concat([picked, cand], ignore_index=True).drop_duplicates()
    return picked.iloc[:n]


def wide(counts: pd.DataFrame, rows: pd.DataFrame, coverage: dict) -> pd.DataFrame:
    """Attach per-sensor FIRMS columns to the sampled cell-days."""
    out = rows.copy()
    for source in schema.SOURCES:
        part = counts[counts["source"] == source]
        cols = {"n_fire": "n_fire", "n_fire_high": "n_fire_high", "frp_max": "frp_max", "n_nonfire": "n_nonfire"}
        if source == "LANDSAT":  # no FRP and no type flag
            cols = {"n_fire": "n_fire", "n_fire_high": "n_fire_high"}
        part = part[[*KEY, *cols]].rename(columns={c: f"{c}_{source.lower()}" for c in cols})
        out = out.merge(part, on=KEY, how="left")
        first, last = coverage[source]
        in_archive = (out["date"] >= first) & (out["date"] <= last)
        for c in cols:
            name = f"{c}_{source.lower()}"
            if c != "frp_max":  # no detection inside the archive period is a real zero
                out[name] = out[name].fillna(0).where(in_archive).astype("Int32")
    return out


def run(input_dir: Path, output_dir: Path, ratio: float, seed: int,
        val_year: int, test_year: int) -> dict:
    counts = read_counts(input_dir)
    counts["year"] = counts["date"].str[:4].astype(int)
    coverage = {s: (g["date"].min(), g["date"].max()) for s, g in counts.groupby("source")}
    fire_days = counts[counts["n_fire"] > 0][[*KEY, "year"]].drop_duplicates()
    cells = cell_table(fire_days)
    output_dir.mkdir(parents=True, exist_ok=True)
    cells.to_csv(output_dir / "cells.csv.gz", index=False, float_format="%.5f")

    rng = np.random.default_rng(seed)
    first, last = counts["date"].min(), counts["date"].max()
    summary = {"cells": len(cells), "sensor_coverage": coverage, "background_ratio": ratio,
               "seed": seed, "years": {}}
    (output_dir / "sample").mkdir(exist_ok=True)
    for year, fire in fire_days.groupby("year"):
        year_counts = counts[counts["year"] == year]
        dates = pd.date_range(max(first, f"{year}-01-01"), min(last, f"{year}-12-31"))
        taken = pd.MultiIndex.from_frame(year_counts[KEY].drop_duplicates())
        back = background(cells, taken, dates, int(round(len(fire) * ratio)), rng)
        rows = pd.concat([fire[KEY].assign(background=0), back.assign(background=1)], ignore_index=True)
        rows[CELL] = rows[CELL].astype("int16")
        rows = rows.sort_values(KEY, ignore_index=True)
        rows["split"] = "test" if year >= test_year else "validation" if year >= val_year else "train"
        table = wide(year_counts, rows, coverage)
        table.to_csv(output_dir / "sample" / f"{year}.csv.gz", index=False, float_format="%.2f",
                     compression={"method": "gzip", "compresslevel": 4})
        summary["years"][int(year)] = {"fire": len(fire), "background": len(back),
                                       "split": rows["split"].iloc[0]}
        print(f"{year}: {len(fire):,} fire + {len(back):,} background", flush=True)
    (output_dir / "sample_summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("input_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--background", type=float, default=1.0, help="background rows per fire row")
    parser.add_argument("--seed", type=int, default=20261114)
    parser.add_argument("--validation-year", type=int, default=2025)
    parser.add_argument("--test-year", type=int, default=2026)
    args = parser.parse_args()
    run(args.input_dir, args.output_dir, args.background, args.seed, args.validation_year, args.test_year)


if __name__ == "__main__":
    main()
