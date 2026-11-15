"""A serving-compatible subset of compiled features: place, season and 24h weather.

No same-day detections, targets, fire history, old Daymet values or absent fuel
features are used. Training weather wind speeds are m/s; live speeds are km/h.
"""
from datetime import timedelta

import numpy as np
import pandas as pd

from model.schema import PredictionBundle
from shared import grid

FEATURES = [
    "latitude", "longitude", "doy_sin", "doy_cos", "om_elevation",
    "om_temp_max", "om_temp_min", "om_temp_mean", "om_rh_min", "om_rh_mean",
    "om_vpd_max", "om_vpd_mean", "om_precip_sum", "om_wind_max", "om_wind_mean",
    "om_gust_max", "om_wind_from_sin", "om_wind_from_cos",
]


def weather_features(hours, elevation):
    """One complete 24h sequence -> the same definitions as compile_dataset.py."""
    def values(name):
        return np.asarray([getattr(hour, name) for hour in hours], dtype=float)
    temp, rh, vpd, rain = (values(key) for key in (
        "temperature", "humidity", "vapour_pressure_deficit_kpa", "precipitation_mm"))
    wind, gust = values("wind_speed_kph") / 3.6, values("wind_gusts_kph") / 3.6
    angle = np.radians(values("wind_direction"))
    east, north = np.mean(wind * np.sin(angle)), np.mean(wind * np.cos(angle))
    speed = np.hypot(east, north)
    return {
        "om_elevation": elevation, "om_temp_max": temp.max(), "om_temp_min": temp.min(),
        "om_temp_mean": temp.mean(), "om_rh_min": rh.min(), "om_rh_mean": rh.mean(),
        "om_vpd_max": vpd.max(), "om_vpd_mean": vpd.mean(), "om_precip_sum": rain.sum(),
        "om_wind_max": wind.max(), "om_wind_mean": wind.mean(), "om_gust_max": gust.max(),
        "om_wind_from_sin": east / speed if speed > 1e-12 else 0.0,
        "om_wind_from_cos": north / speed if speed > 1e-12 else 0.0,
        "_wind_east": east, "_wind_north": north,
    }


def bundle_features(bundle: PredictionBundle):
    """Aggregate display samples by native 10 km training cell; return display mapping."""
    cells = bundle.weather_grid.cells
    x, y = grid.to_albers([c.latitude for c in cells], [c.longitude for c in cells])
    rows, cols = grid.cell_index(x, y)
    if np.any(rows < 0) or np.any(cols < 0):
        raise ValueError("Prediction region is outside the model's CONUS frame")
    groups = {}
    for index, (row, col) in enumerate(zip(rows, cols)):
        groups.setdefault((int(row), int(col)), []).append(index)
    samples = bundle.weather_grid.samples
    sample_features = [weather_features(sample.hourly[:24], sample.elevation_m) for sample in samples]
    start = samples[0].hourly[0].time
    records, mapping, ids = [], np.empty(len(cells), dtype=int), []
    for native_index, ((row, col), indices) in enumerate(groups.items()):
        cx, cy = grid.cell_centre(row, col)
        lat, lon = grid.from_albers(cx, cy)
        # The compiled target uses local-solar dates. A rolling 24h forecast is
        # approximated by its midpoint's local-solar date; report the true window.
        local_day = (start + timedelta(hours=12 + float(lon) / 15)).date()
        season = 2 * np.pi * (local_day.timetuple().tm_yday - 1) / 365.25
        record = {
            "latitude": float(lat), "longitude": float(lon),
            "doy_sin": np.sin(season), "doy_cos": np.cos(season),
        }
        for key in FEATURES[4:]:
            record[key] = float(np.mean([sample_features[cells[i].sample_index][key] for i in indices]))
        east = np.mean([sample_features[cells[i].sample_index]["_wind_east"] for i in indices])
        north = np.mean([sample_features[cells[i].sample_index]["_wind_north"] for i in indices])
        speed = np.hypot(east, north)
        record["om_wind_from_sin"] = east / speed if speed > 1e-12 else 0.0
        record["om_wind_from_cos"] = north / speed if speed > 1e-12 else 0.0
        records.append(record)
        mapping[indices] = native_index
        ids.append(grid.cell_id(row, col))
    return pd.DataFrame(records, columns=FEATURES), mapping, ids, start
