"""Step 7 of the training bundle: one model-input table, split into train, validation and test.

Run from apps/inference, after the FIRMS, Daymet, LANDFIRE and Open-Meteo steps:

    python -m harmonization.compile_dataset ../../data

Rows are the sampled cell-days that have Open-Meteo weather (the fetched part
of weather_queue.csv.gz). Each gets columns from all four sources:

  FIRMS      the target `fire`, same-day detail (`label_*`), and fire history
             in the cell and its 8 neighbours before the date (`firms_*`)
  Open-Meteo that day's weather and the 6 days before it (`om_*`)
  Daymet     that day's values and 7/30/90-day antecedent conditions (`dm_*`)
  LANDFIRE   elevation, slope and aspect of the cell (`topo_*`)

Writes to <data>/training/compiled:

  dataset.csv.gz      every row, with `split` and, for rows left out of the
                      splits, `excluded_reason`
  train.csv.gz, validation.csv.gz, test.csv.gz
                      the rows complete in all four sources
  columns.json        the role of every column: id, target, label_detail,
                      feature or meta. Only `feature` columns are model inputs;
                      `label_*` describe the same day as the target and leak it.
  summary.json        row counts, split boundaries, exclusions
  _parts/             per-source feature tables, reused on the next run
                      (`--force` rebuilds them)

The split is 60/20/20 by default and by time (`--split-by time`): rows are
ordered by date and cut so that validation follows train and test follows
validation, with no date in two subsets. Nearby cell-days are correlated, so a
random split (`--split-by random`) scores better than the model will do on new
dates; use it only if that is understood.

`date` is the local solar date, as in firms_cells.py. Daymet has no 31
December in leap years (it keeps 365-day years); that day uses 30 December.
"""
from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

import numpy as np
import pandas as pd

from shared import grid
from sources.topography import landfire

KEY = ["date", "cell_row", "cell_col"]
CELL = ["cell_row", "cell_col"]
EPOCH = pd.Timestamp("2000-01-01")
HOURLY = [
    "temperature_2m", "relative_humidity_2m", "vapour_pressure_deficit", "precipitation",
    "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m", "soil_moisture_0_to_7cm",
]
WINDOW_DAYS = 7
DAY_SPAN = 20_000          # days per cell in the packed (cell, day) key; 54 years from EPOCH
SINCE_CAP = 3650           # "no earlier fire" and anything older count as ten years
DRY_DAY_MM, DRY_CAP = 1.0, 90
NEIGHBOURS = [(dr, dc) for dr in (-1, 0, 1) for dc in (-1, 0, 1) if (dr, dc) != (0, 0)]


# --- Open-Meteo ---------------------------------------------------------------

def hourly_features(hourly: np.ndarray) -> dict[str, np.ndarray]:
    """(rows, variables in HOURLY order, 7 x 24 hours) -> daily features.

    The last 24 hours are the row's own date; the 144 before are the 6 days
    leading up to it.
    """
    days = hourly.reshape(len(hourly), len(HOURLY), WINDOW_DAYS, 24)
    temp, rh, vpd, rain, wind, gust, direction, soil = (days[:, i] for i in range(len(HOURLY)))
    today, before = (slice(None), -1), (slice(None), slice(0, -1))
    angle = np.radians(direction[today])  # where the wind blows from
    east, north = (wind[today] * np.sin(angle)).mean(1), (wind[today] * np.cos(angle)).mean(1)
    speed = np.hypot(east, north)
    still = speed == 0
    return {
        "om_temp_max": temp[today].max(1), "om_temp_min": temp[today].min(1), "om_temp_mean": temp[today].mean(1),
        "om_rh_min": rh[today].min(1), "om_rh_mean": rh[today].mean(1),
        "om_vpd_max": vpd[today].max(1), "om_vpd_mean": vpd[today].mean(1),
        "om_precip_sum": rain[today].sum(1),
        "om_wind_max": wind[today].max(1), "om_wind_mean": wind[today].mean(1), "om_gust_max": gust[today].max(1),
        "om_wind_from_sin": np.where(still, 0.0, east / np.where(still, 1, speed)),
        "om_wind_from_cos": np.where(still, 0.0, north / np.where(still, 1, speed)),
        "om_soil_moisture_mean": soil[today].mean(1),
        "om_precip_sum_prev6d": rain[before].sum((1, 2)),
        "om_temp_max_prev6d": temp[before].max(2).mean(1),
        "om_rh_min_prev6d": rh[before].min(2).mean(1),
        "om_vpd_max_prev6d": vpd[before].max(2).mean(1),
        "om_wind_max_prev6d": wind[before].max((1, 2)),
        "om_soil_moisture_mean_prev6d": soil[before].mean((1, 2)),
    }


def weather_features(history: Path) -> pd.DataFrame:
    keys, blocks = [], []
    with open(history, encoding="utf-8") as lines:
        for line in lines:
            record = json.loads(line)
            block = [record["hourly"][name] for name in HOURLY]
            if any(len(values) != WINDOW_DAYS * 24 for values in block):
                continue  # a short answer from the API; the row is left without weather
            keys.append((record["date"], int(record["cell_row"]), int(record["cell_col"]), record.get("elevation")))
            blocks.append(block)
    out = pd.DataFrame(keys, columns=[*KEY, "om_elevation"])
    out = out.assign(**hourly_features(np.array(blocks, dtype="float64")))
    return out.drop_duplicates(KEY, keep="last", ignore_index=True)


# --- Daymet -------------------------------------------------------------------

def daymet_index(dates) -> np.ndarray:
    """Position of each date in a Daymet series that starts on 1 January 2000."""
    d = pd.DatetimeIndex(pd.to_datetime(dates))
    return ((d.year - EPOCH.year) * 365 + np.minimum(d.dayofyear, 365) - 1).to_numpy()


def read_daymet(path: Path) -> np.ndarray:
    """A Single Pixel download -> (days, 4) array of prcp, tmax, tmin, vp; gaps are NaN."""
    with gzip.open(path, "rt") as text:
        for line in text:
            if line.startswith("year,"):
                break
        table = np.loadtxt(text, delimiter=",", ndmin=2)
    index = ((table[:, 0] - EPOCH.year) * 365 + table[:, 1] - 1).astype(int)
    series = np.full((index.max() + 1, 4), np.nan)
    series[index] = table[:, 2:6]
    return series


def saturation_kpa(celsius):
    return 0.6108 * np.exp(17.27 * celsius / (celsius + 237.3))


def daymet_point(series: np.ndarray, i: int) -> dict[str, float]:
    """Features for day `i` of one cell's series; NaN wherever the series does not reach."""
    prcp, tmax, tmin, vp = series.T
    vpd = np.maximum((saturation_kpa(tmax) + saturation_kpa(tmin)) / 2 - vp / 1000, 0)
    here = 0 <= i < len(series)

    def before(values, days, reduce):
        return reduce(values[i - days:i]) if 0 <= i - days and i <= len(series) else np.nan

    dry = before(prcp, DRY_CAP, lambda v: float("nan") if np.isnan(v).any() else
                 float(np.argmax(v[::-1] >= DRY_DAY_MM)) if (v >= DRY_DAY_MM).any() else float(DRY_CAP))
    return {
        "dm_prcp": prcp[i] if here else np.nan, "dm_tmax": tmax[i] if here else np.nan,
        "dm_tmin": tmin[i] if here else np.nan, "dm_vpd": vpd[i] if here else np.nan,
        "dm_prcp_sum_prev7d": before(prcp, 7, np.sum), "dm_prcp_sum_prev30d": before(prcp, 30, np.sum),
        "dm_prcp_sum_prev90d": before(prcp, 90, np.sum),
        "dm_tmax_mean_prev7d": before(tmax, 7, np.mean), "dm_tmax_mean_prev30d": before(tmax, 30, np.mean),
        "dm_vpd_mean_prev7d": before(vpd, 7, np.mean), "dm_vpd_mean_prev30d": before(vpd, 30, np.mean),
        "dm_dry_days": dry,
    }


def daymet_features(daymet_dir: Path, rows: pd.DataFrame) -> pd.DataFrame:
    """Daymet columns for `rows` (date, cell_row, cell_col); rows whose cell has no file are omitted."""
    out = []
    index = daymet_index(rows["date"])
    for (row, col), group in rows.assign(_i=index).groupby(CELL):
        cell = grid.cell_id(row, col)
        path = daymet_dir / cell[:6] / f"{cell}.csv.gz"
        if not path.exists():
            continue
        series = read_daymet(path)
        out += [{"date": date, "cell_row": row, "cell_col": col, **daymet_point(series, i)}
                for date, i in zip(group["date"], group["_i"])]
    return pd.DataFrame(out)


# --- FIRMS --------------------------------------------------------------------

def day_number(dates) -> np.ndarray:
    return (pd.to_datetime(dates) - EPOCH).days.to_numpy() if isinstance(dates, pd.Index) \
        else (pd.to_datetime(dates) - EPOCH).dt.days.to_numpy()


def pack(cell_row, cell_col, day) -> np.ndarray:
    """(cell, day) -> one sortable integer; all days of a cell are contiguous."""
    cell = np.asarray(cell_row, dtype="int64") * grid.N_CELL_COLS + np.asarray(cell_col, dtype="int64")
    return cell * DAY_SPAN + np.asarray(day, dtype="int64")


def fire_history(fire_keys: np.ndarray, cell_row, cell_col, day) -> dict[str, np.ndarray]:
    """Fire activity strictly before `day`, from the sorted packed keys of every fire cell-day."""
    cell_row, cell_col, day = (np.asarray(v, dtype="int64") for v in (cell_row, cell_col, day))

    def count(row, col, days):
        inside = (row >= 0) & (row < grid.N_CELL_ROWS) & (col >= 0) & (col < grid.N_CELL_COLS)
        first = pack(row, col, np.maximum(day - days, 0))
        n = np.searchsorted(fire_keys, pack(row, col, day)) - np.searchsorted(fire_keys, first)
        return np.where(inside, n, 0)

    out = {f"firms_fire_days_prev{d}d": count(cell_row, cell_col, d) for d in (1, 7, 30, 365)}
    last = np.searchsorted(fire_keys, pack(cell_row, cell_col, day)) - 1
    found = (last >= 0) & (fire_keys[np.maximum(last, 0)] // DAY_SPAN == pack(cell_row, cell_col, 0) // DAY_SPAN)
    since = day - fire_keys[np.maximum(last, 0)] % DAY_SPAN
    out["firms_days_since_fire"] = np.where(found, np.minimum(since, SINCE_CAP), SINCE_CAP)
    for days in (1, 7):
        out[f"firms_neighbour_fire_days_prev{days}d"] = sum(
            count(cell_row + dr, cell_col + dc, days) for dr, dc in NEIGHBOURS)
    return out


def firms_features(cell_day_dir: Path, rows: pd.DataFrame) -> pd.DataFrame:
    """Target detail and fire history for `rows`, from the firms_cells.py output."""
    parts, coverage = [], {}
    for path in sorted(cell_day_dir.glob("*/*.csv.gz")):
        part = pd.read_csv(path, usecols=[*KEY, "source", "n_fire", "frp_max"])
        day = day_number(part["date"])
        first, last = coverage.get(path.parent.name, (day.min(), day.max()))
        coverage[path.parent.name] = (min(first, day.min()), max(last, day.max()))
        fire = (part["n_fire"] > 0).to_numpy()
        parts.append(pd.DataFrame({"key": pack(part["cell_row"], part["cell_col"], day)[fire],
                                   "n": part["n_fire"].to_numpy()[fire], "frp": part["frp_max"].to_numpy()[fire]}))
    fires = pd.concat(parts, ignore_index=True).groupby("key").agg(
        label_n_detections=("n", "sum"), label_frp_max=("frp", "max"))
    day = day_number(rows["date"])
    out = rows[KEY].reset_index(drop=True)
    detail = fires.reindex(pack(out["cell_row"], out["cell_col"], day))
    out["label_n_detections"] = detail["label_n_detections"].fillna(0).astype(int).to_numpy()
    out["label_frp_max"] = detail["label_frp_max"].to_numpy()
    out = out.assign(**fire_history(fires.index.to_numpy(), out["cell_row"], out["cell_col"], day))
    out["firms_sensors_active"] = sum(((day >= a) & (day <= b)).astype(int) for a, b in coverage.values())
    return out


# --- Split and assembly -------------------------------------------------------

def assign_split(dates: pd.Series, ratios=(0.6, 0.2, 0.2), by: str = "time", seed: int = 20261114) -> np.ndarray:
    """'train' / 'validation' / 'test' for each row.

    By time, rows sharing a date always land in the same subset (the later one
    when a boundary falls inside a date), so the ratios are met to within one
    date's rows.
    """
    n = len(dates)
    if by == "random":
        rank = np.empty(n)
        rank[np.random.default_rng(seed).permutation(n)] = np.arange(n)
    else:
        rank = pd.Series(pd.to_datetime(dates).to_numpy()).rank(method="min").to_numpy() - 1
    share = rank / max(n, 1)
    total = float(sum(ratios))
    return np.select([share < ratios[0] / total, share < (ratios[0] + ratios[1]) / total],
                     ["train", "validation"], "test")


def role(column: str) -> str:
    if column in (*KEY, "cell_id"):
        return "id"
    if column == "fire":
        return "target"
    if column.startswith("label_"):
        return "label_detail"
    if column in ("split", "excluded_reason"):
        return "meta"
    return "feature"


def cached(path: Path, force: bool, build) -> pd.DataFrame:
    if force or not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        build().to_csv(path, index=False, float_format="%.6g")
        print(f"built {path.name}", flush=True)
    return pd.read_csv(path)


def run(data_dir: Path, output_dir: Path, ratios, split_by: str, seed: int, pixel_m: float, force: bool) -> dict:
    training = data_dir / "training"
    parts = output_dir / "_parts"
    weather = cached(parts / "open_meteo.csv.gz", force, lambda: weather_features(data_dir / "open-meteo_us" / "history.jsonl"))
    queue = pd.read_csv(training / "weather_queue.csv.gz", usecols=[*KEY, "background"])
    rows = weather[KEY].merge(queue, on=KEY, how="left", validate="one_to_one")
    cells = rows[CELL].drop_duplicates()
    topo = cached(parts / "landfire.csv.gz", force, lambda: landfire.cell_stats(data_dir / "landfire_us", cells, pixel_m))
    daymet = cached(parts / "daymet.csv.gz", force, lambda: daymet_features(data_dir / "daymet_us", rows))
    firms = cached(parts / "firms.csv.gz", force, lambda: firms_features(training / "firms_cell_day", rows))

    x, y = grid.cell_centre(rows["cell_row"], rows["cell_col"])
    latitude, longitude = grid.from_albers(x, y)
    when = pd.to_datetime(rows["date"])
    season = 2 * np.pi * (when.dt.dayofyear - 1) / 365.25
    table = rows[KEY].assign(
        cell_id=[grid.cell_id(r, c) for r, c in zip(rows["cell_row"], rows["cell_col"])],
        fire=(1 - rows["background"]).astype("Int8"),
        latitude=latitude, longitude=longitude, year=when.dt.year,
        doy_sin=np.sin(season), doy_cos=np.cos(season),
    )
    table = (table.merge(firms, on=KEY, how="left").merge(weather, on=KEY, how="left")
             .merge(daymet, on=KEY, how="left").merge(topo, on=CELL, how="left"))

    dm = [c for c in table if c.startswith("dm_")]
    om = [c for c in table if c.startswith("om_")]
    reason = pd.Series("", index=table.index)
    reason[table[om].isna().any(axis=1)] = "open-meteo incomplete"
    reason[table[[c for c in table if c.startswith("topo_")]].isna().any(axis=1)] = "outside LANDFIRE"
    reason[table[dm].isna().any(axis=1)] = "date outside the Daymet series"
    reason[table["dm_tmax"].isna() & ~table[KEY].merge(daymet[KEY].assign(_f=1), on=KEY, how="left")["_f"].notna()] = \
        "no Daymet for the cell (water)"
    reason[table["fire"].isna()] = "not in weather_queue"
    complete = reason == ""
    table["split"] = "excluded"
    table.loc[complete, "split"] = assign_split(table.loc[complete, "date"], ratios, split_by, seed)
    table["excluded_reason"] = reason
    table = table.sort_values(KEY, ignore_index=True)
    floats = table.select_dtypes("float").columns
    table[floats] = table[floats].round(4)

    output_dir.mkdir(parents=True, exist_ok=True)
    gz = {"method": "gzip", "compresslevel": 6}
    table.to_csv(output_dir / "dataset.csv.gz", index=False, compression=gz)
    summary = {"rows": len(table), "split_by": split_by, "ratios": list(ratios), "seed": seed,
               "landfire_pixel_m": pixel_m, "excluded": reason[~complete].value_counts().to_dict(), "splits": {}}
    for name in ("train", "validation", "test"):
        subset = table[table["split"] == name].drop(columns=["split", "excluded_reason"])
        subset.to_csv(output_dir / f"{name}.csv.gz", index=False, compression=gz)
        summary["splits"][name] = {
            "rows": len(subset), "share": round(len(subset) / max(int(complete.sum()), 1), 4),
            "fire": int(subset["fire"].sum()), "background": int((subset["fire"] == 0).sum()),
            "first_date": subset["date"].min(), "last_date": subset["date"].max(),
            "cells": int(subset[CELL].drop_duplicates().shape[0]),
        }
    (output_dir / "columns.json").write_text(json.dumps({c: role(c) for c in table.columns}, indent=2) + "\n")
    (output_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("--output-dir", type=Path, help="default: <data_dir>/training/compiled")
    parser.add_argument("--ratios", type=float, nargs=3, default=(0.6, 0.2, 0.2), metavar=("TRAIN", "VAL", "TEST"))
    parser.add_argument("--split-by", choices=("time", "random"), default="time")
    parser.add_argument("--seed", type=int, default=20261114, help="only used by --split-by random")
    parser.add_argument("--landfire-pixel-m", type=float, default=240.0, help="pyramid level to summarise cells from")
    parser.add_argument("--force", action="store_true", help="rebuild the per-source tables in _parts")
    args = parser.parse_args()
    summary = run(args.data_dir, args.output_dir or args.data_dir / "training" / "compiled",
                  tuple(args.ratios), args.split_by, args.seed, args.landfire_pixel_m, args.force)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
