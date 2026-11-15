"""Turn the orchestrator's live `dataBundle` into model inputs.

The bundle is a region of about 28 km sampled on a 1 km grid (row-major, north
to south, west to east; see apps/orchestrator/src/fan-out/types.ts). The
occurrence model was trained on 10 km cell-days, so each 1 km cell gets:

- weather from its own Open-Meteo sample, summarised over the forecast hours
  the same way `compile_dataset.hourly_features` summarises a day;
- terrain summarised over a 10 km window around it;
- fire history of the 10 km project cell it falls in, from the FIRMS archive
  index plus the bundle's own detections.

The prediction day is the local solar day after the bundle's observation
time, so everything detected so far counts as history.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from harmonization.compile_dataset import EPOCH, fire_history, pack
from model import features
from shared import grid

KM_PER_DEGREE = 111.195
KPH_TO_MS = 1 / 3.6
TERRAIN_WINDOW_CELLS = 5      # +/- cells around each cell: about a 10 km window on the 1 km grid
LOW_CONFIDENCE_PERCENT = 30   # FIRMS MODIS: below 30 is the "low" class


class BundleError(ValueError):
    """The bundle is missing something the models need."""


@dataclass
class Region:
    rows: int
    columns: int
    bounds: dict
    latitude: np.ndarray        # (rows, columns), cell centres
    longitude: np.ndarray
    observed_at: pd.Timestamp   # UTC, naive
    cell_km: tuple[float, float]  # (north-south, east-west)

    @property
    def shape(self) -> tuple[int, int]:
        return self.rows, self.columns

    def cell_of(self, latitude, longitude):
        """(row, column) of the grid cell holding each point; -1 outside the region."""
        b = self.bounds
        row = np.floor((b["north"] - np.asarray(latitude, dtype="float64")) / (b["north"] - b["south"]) * self.rows)
        col = np.floor((np.asarray(longitude, dtype="float64") - b["west"]) / (b["east"] - b["west"]) * self.columns)
        inside = (row >= 0) & (row < self.rows) & (col >= 0) & (col < self.columns)
        return np.where(inside, row, -1).astype(int), np.where(inside, col, -1).astype(int)


def _require(mapping, key, where):
    if not isinstance(mapping, dict) or key not in mapping or mapping[key] is None:
        raise BundleError(f"Bundle is missing {where}.{key}")
    return mapping[key]


def _utc(text) -> pd.Timestamp:
    return pd.Timestamp(text).tz_convert("UTC").tz_localize(None) if pd.Timestamp(text).tzinfo else pd.Timestamp(text)


def region_of(bundle: dict) -> Region:
    weather = _require(bundle, "weather_grid", "bundle")
    rows, columns = int(_require(weather, "rows", "weather_grid")), int(_require(weather, "columns", "weather_grid"))
    cells = _require(weather, "cells", "weather_grid")
    if len(cells) != rows * columns:
        raise BundleError(f"weather_grid has {len(cells)} cells for a {rows} x {columns} grid")
    bounds = _require(weather, "bounds", "weather_grid")
    latitude = np.array([c["latitude"] for c in cells], dtype="float64").reshape(rows, columns)
    longitude = np.array([c["longitude"] for c in cells], dtype="float64").reshape(rows, columns)
    return Region(
        rows=rows, columns=columns, bounds=bounds, latitude=latitude, longitude=longitude,
        observed_at=_utc(_require(bundle, "observation_time", "bundle")),
        cell_km=((bounds["north"] - bounds["south"]) * KM_PER_DEGREE / rows,
                 (bounds["east"] - bounds["west"]) * KM_PER_DEGREE * np.cos(np.radians(latitude.mean())) / columns))


def grid_values(source: dict, field: str, region: Region) -> np.ndarray:
    """One field of a terrain or vegetation grid as (rows, columns) floats; null becomes NaN.

    A grid with a different shape is resampled to the region by nearest cell.
    """
    rows, columns = int(source["rows"]), int(source["columns"])
    values = np.array([np.nan if c.get(field) is None else c[field] for c in source["cells"]], dtype="float64")
    if len(values) != rows * columns:
        raise BundleError(f"A {rows} x {columns} grid has {len(values)} cells")
    values = values.reshape(rows, columns)
    if (rows, columns) != region.shape:
        r = np.minimum((np.arange(region.rows) + 0.5) * rows // region.rows, rows - 1).astype(int)
        c = np.minimum((np.arange(region.columns) + 0.5) * columns // region.columns, columns - 1).astype(int)
        values = values[np.ix_(r, c)]
    return values


# --- Weather ------------------------------------------------------------------

WEATHER_FIELDS = ["temperature", "humidity", "vapour_pressure_deficit_kpa", "precipitation_mm",
                  "wind_speed_kph", "wind_gusts_kph", "wind_direction"]


def sample_hours(sample: dict) -> np.ndarray:
    """(hours, WEATHER_FIELDS) for one weather sample; the current reading if there is no forecast."""
    hours = sample.get("hourly") or [_require(sample, "current", "weather_grid.samples[]")]
    return np.array([[hour[field] for field in WEATHER_FIELDS] for hour in hours], dtype="float64")


def weather_summary(hours: np.ndarray) -> dict[str, float]:
    """Daily features from hourly values, as in compile_dataset.hourly_features (wind in m/s)."""
    temp, rh, vpd, rain, wind, gust, direction = hours.T
    wind, gust = wind * KPH_TO_MS, gust * KPH_TO_MS
    angle = np.radians(direction)
    east, north = (wind * np.sin(angle)).mean(), (wind * np.cos(angle)).mean()
    speed = np.hypot(east, north)
    return {
        "om_temp_max": temp.max(), "om_temp_min": temp.min(), "om_temp_mean": temp.mean(),
        "om_rh_min": rh.min(), "om_rh_mean": rh.mean(),
        "om_vpd_max": vpd.max(), "om_vpd_mean": vpd.mean(), "om_precip_sum": rain.sum(),
        "om_wind_max": wind.max(), "om_wind_mean": wind.mean(), "om_gust_max": gust.max(),
        "om_wind_from_sin": east / speed if speed > 0 else 0.0,
        "om_wind_from_cos": north / speed if speed > 0 else 0.0,
    }


def sample_index(bundle: dict, region: Region) -> np.ndarray:
    weather = bundle["weather_grid"]
    index = np.array([c.get("sample_index", 0) for c in weather["cells"]], dtype=int)
    if index.min() < 0 or index.max() >= len(_require(weather, "samples", "weather_grid")):
        raise BundleError("weather_grid.cells point at a weather sample that is not in the bundle")
    return index.reshape(region.shape)


def weather_features(bundle: dict, region: Region) -> pd.DataFrame:
    index = sample_index(bundle, region).ravel()
    samples = bundle["weather_grid"]["samples"]
    summaries = {i: weather_summary(sample_hours(samples[i])) for i in np.unique(index)}
    return pd.DataFrame([summaries[i] for i in index])


# --- Terrain ------------------------------------------------------------------

def terrain_features(bundle: dict, region: Region) -> pd.DataFrame:
    """Elevation, slope and aspect summarised over a window around each cell (the topo_* columns)."""
    source = _require(_require(bundle, "terrain", "bundle"), "grid", "terrain")
    elevation, slope, aspect = (grid_values(source, f, region) for f in ("elevation_m", "slope_degrees", "aspect_degrees"))
    flat = np.isnan(aspect)                       # 3DEP reports no aspect for flat cells
    north = np.where(flat, 0.0, np.cos(np.radians(np.nan_to_num(aspect))))
    east = np.where(flat, 0.0, np.sin(np.radians(np.nan_to_num(aspect))))
    if np.isnan(elevation).all() or np.isnan(slope).all():
        raise BundleError("terrain.grid has no elevation or slope values")
    w, out = TERRAIN_WINDOW_CELLS, []
    for r in range(region.rows):
        for c in range(region.columns):
            window = (slice(max(r - w, 0), r + w + 1), slice(max(c - w, 0), c + w + 1))
            e, s = elevation[window], slope[window]
            e = e if np.isfinite(e).any() else elevation
            s = s if np.isfinite(s).any() else slope
            out.append((np.nanmean(e), np.nanstd(e), np.nanmean(s), np.nanpercentile(s, 90),
                        north[window].mean(), east[window].mean(), flat[window].mean()))
    return pd.DataFrame(out, columns=features.TOPOGRAPHY)


# --- Fire detections and history ------------------------------------------------

def detections_frame(bundle: dict) -> pd.DataFrame:
    """The bundle's detections with the project cell, local solar day and a confidence class."""
    rows = []
    for d in _require(bundle, "fire", "bundle").get("detections", []):
        confidence = d.get("confidence") or {}
        if confidence.get("kind") == "percent":
            low, high = confidence["value"] < LOW_CONFIDENCE_PERCENT, confidence["value"] > 80
        else:
            low, high = confidence.get("value") == "low", confidence.get("value") == "high"
        rows.append((d["location"]["latitude"], d["location"]["longitude"], _utc(d["observation_time"]),
                     d.get("source", ""), d.get("frp_mw"), low, high))
    frame = pd.DataFrame(rows, columns=["latitude", "longitude", "time", "source", "frp_mw", "low", "high"])
    frame["frp_mw"] = frame["frp_mw"].astype("float64")
    frame["time"] = pd.to_datetime(frame["time"])
    x, y = grid.to_albers(frame["latitude"], frame["longitude"])
    frame["cell_row"], frame["cell_col"] = grid.cell_index(x, y)
    local = frame["time"] + pd.to_timedelta(frame["longitude"].to_numpy() * 240.0, unit="s")
    frame["day"] = (local.dt.normalize() - EPOCH).dt.days if len(frame) else np.array([], dtype="int64")
    return frame


def local_day(region: Region) -> int:
    """Local solar day number of the bundle's observation time at the region centre."""
    local = region.observed_at + pd.Timedelta(seconds=float(region.longitude.mean()) * 240.0)
    return int((local.normalize() - EPOCH).days)


def merged_fire_keys(archive_keys: np.ndarray, detections: pd.DataFrame) -> np.ndarray:
    """Archive fire cell-days plus the bundle's own (inside the project grid), sorted."""
    inside = detections[detections["cell_row"] >= 0]
    live = pack(inside["cell_row"], inside["cell_col"], inside["day"])
    keys = np.union1d(archive_keys, live)
    return keys if len(keys) else np.array([-1], dtype="int64")  # fire_history needs one key; -1 matches no cell


def occurrence_features(bundle: dict, archive_keys: np.ndarray) -> tuple[Region, pd.DataFrame]:
    """One row per region cell (row-major) with every column the occurrence model takes."""
    region = region_of(bundle)
    day = local_day(region) + 1
    date = EPOCH + pd.Timedelta(days=day)
    season = 2 * np.pi * (date.dayofyear - 1) / 365.25  # as compile_dataset
    x, y = grid.to_albers(region.latitude.ravel(), region.longitude.ravel())
    cell_row, cell_col = grid.cell_index(x, y)
    if (cell_row < 0).any():
        raise BundleError("The region is outside the CONUS model grid")
    keys = merged_fire_keys(archive_keys, detections_frame(bundle))
    history = fire_history(keys, cell_row, cell_col, np.full(len(cell_row), day))
    frame = pd.concat([
        pd.DataFrame({"latitude": region.latitude.ravel(), "longitude": region.longitude.ravel(),
                      "doy_sin": np.sin(season), "doy_cos": np.cos(season)}),
        pd.DataFrame(history), weather_features(bundle, region), terrain_features(bundle, region),
    ], axis=1)
    return region, frame[features.OCCURRENCE_FEATURES]


def cell_polygon(region: Region, row: int, column: int) -> list:
    """GeoJSON ring (EPSG:4326) of one region cell."""
    b = region.bounds
    dy, dx = (b["north"] - b["south"]) / region.rows, (b["east"] - b["west"]) / region.columns
    north, west = b["north"] - row * dy, b["west"] + column * dx
    return [[[west, north - dy], [west + dx, north - dy], [west + dx, north], [west, north], [west, north - dy]]]
