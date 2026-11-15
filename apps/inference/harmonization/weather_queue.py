"""Step 6a of the training bundle: the order in which cell-days get Open-Meteo weather.

Run from apps/inference, after harmonization.training_sample:

    python -m harmonization.weather_queue ../../data/training

Open-Meteo's free tier allows about 10,000 calls a day, far fewer than the
7.3 M sampled cell-days. This writes `weather_queue.csv.gz`: a fixed random
subset of the sample in a fixed random order. `sources.weather.fetch_history`
works down it a day's budget at a time, so the rows that have weather are
always an unbiased subsample, however far the fetch has got.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

COLUMNS = ["date", "cell_row", "cell_col", "background", "split"]


def build(training_dir: Path, rows: int, seed: int) -> pd.DataFrame:
    parts = [pd.read_csv(p, usecols=COLUMNS) for p in sorted((training_dir / "sample").glob("*.csv.gz"))]
    sample = pd.concat(parts, ignore_index=True)
    queue = sample.sample(n=min(rows, len(sample)), random_state=seed).reset_index(drop=True)
    cells = pd.read_csv(training_dir / "cells.csv.gz", usecols=["cell_row", "cell_col", "latitude", "longitude"])
    return queue.merge(cells, on=["cell_row", "cell_col"], how="left", validate="many_to_one")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("training_dir", type=Path)
    parser.add_argument("--rows", type=int, default=200_000)
    parser.add_argument("--seed", type=int, default=20261114)
    args = parser.parse_args()
    queue = build(args.training_dir, args.rows, args.seed)
    queue.to_csv(args.training_dir / "weather_queue.csv.gz", index=False)
    print(f"{len(queue):,} cell-days queued, {queue[['cell_row', 'cell_col']].drop_duplicates().shape[0]:,} cells")


if __name__ == "__main__":
    main()
