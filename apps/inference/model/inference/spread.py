"""Model 2 at serving time: where a confirmed fire goes in the next 6, 12 and 24 hours.

Two parts:

1. The learned spread model (`train_spread.py`) gives the probability that
   this fire reaches a neighbouring 10 km cell by tomorrow. That is converted
   into a mean spread distance per day.
2. A minimum-travel-time simulation on the bundle's 1 km grid spreads fire
   from the detected cells at that mean rate, faster downwind (elliptical
   fire shape, Anderson 1983), faster uphill (Alexandridis et al. 2008) and
   scaled by fuel type (Scott and Burgan 40 groups).

The spread distance is treated as exponentially distributed, as in the
conversion in step 1, so a cell the simulation reaches after `t` hours has
burned by horizon `T` with probability exp(-t / T).
"""
from __future__ import annotations

import heapq
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from harmonization import bundle_features
from harmonization.bundle_features import Region
from harmonization.compile_dataset import EPOCH, NEIGHBOURS, fire_history
from shared import grid

HORIZONS_H = (6, 12, 24)
OUTLINE_PROBABILITY = 0.5        # outlines enclose the cells at least this likely to have burned
CONFIRM_WINDOW_H = 24            # detections this recent count as the current fire
MIDFLAME_FACTOR = 0.4 / 1.15     # 10 m wind -> 20 ft wind -> midflame (unsheltered)
KPH_TO_MPH = 0.621371
MAX_LENGTH_TO_BREADTH = 8.0
SLOPE_COEFFICIENT = 0.078        # per degree of slope along the spread direction (Alexandridis et al. 2008)
MAX_SLOPE_DEG = 30.0
MIN_RATE_KM_DAY, MAX_RATE_KM_DAY = 0.05, 40.0

# Relative spread rate by Scott and Burgan 40 fuel group (shrub = 1). Rough, assumed values.
FUEL_FACTORS = [
    (91, 92, 0.0),    # urban, snow and ice
    (93, 93, 0.3),    # agriculture: mapped non-burnable, but crop and stubble fires do carry
    (98, 99, 0.0),    # water, barren
    (101, 109, 1.6),  # grass
    (121, 124, 1.3),  # grass-shrub
    (141, 149, 1.0),  # shrub
    (161, 165, 0.8),  # timber understory
    (181, 189, 0.4),  # timber litter
    (201, 204, 0.7),  # slash-blowdown
]


def fuel_factor(codes: np.ndarray) -> np.ndarray:
    """Spread-rate multiplier per cell; unknown or missing fuel counts as 1."""
    out = np.ones(codes.shape)
    for low, high, factor in FUEL_FACTORS:
        out[(codes >= low) & (codes <= high)] = factor
    return out


def length_to_breadth(wind_kph) -> np.ndarray:
    """Fire ellipse length-to-breadth ratio from the 10 m wind (Anderson 1983)."""
    mph = np.asarray(wind_kph, dtype="float64") * KPH_TO_MPH * MIDFLAME_FACTOR
    ratio = 0.936 * np.exp(0.2566 * mph) + 0.461 * np.exp(-0.1548 * mph) - 0.397
    return np.clip(ratio, 1.0, MAX_LENGTH_TO_BREADTH)


def wind_factor(wind_kph, wind_from_deg, bearing_deg):
    """Spread-rate multiplier towards `bearing_deg`, averaging 1 over all directions.

    The fire is an ellipse with the ignition at its rear focus; `bearing_deg`
    and the wind direction are compass degrees.
    """
    ratio = length_to_breadth(wind_kph)
    e = np.sqrt(ratio**2 - 1) / ratio
    off_wind = np.radians(np.asarray(bearing_deg) - (np.asarray(wind_from_deg) + 180.0))
    return np.sqrt(1 - e**2) / (1 - e * np.cos(off_wind))


def slope_factor(rise_m, run_km):
    angle = np.degrees(np.arctan2(rise_m, run_km * 1000.0))
    return np.exp(SLOPE_COEFFICIENT * np.clip(angle, -MAX_SLOPE_DEG, MAX_SLOPE_DEG))


def mean_distance_km(probability: float, cell_km: float = grid.CELL_SIZE_M / 1000) -> float:
    """Mean daily spread distance that gives `probability` of reaching the next cell.

    A fire somewhere in a cell is a uniform 0 to `cell_km` from the edge; with
    an exponential spread distance of mean m, it crosses with probability
    (m / L) (1 - exp(-L / m)). Solved for m by bisection.
    """
    p = float(np.clip(probability, 1e-6, 0.999))
    low, high = 1e-4, 1e4
    for _ in range(80):
        mid = np.sqrt(low * high)
        if mid / cell_km * (1 - np.exp(-cell_km / mid)) < p:
            low = mid
        else:
            high = mid
    return float(np.sqrt(low * high))


# --- The fire as the learned model sees it ---------------------------------------

def confirmed_detections(detections: pd.DataFrame, observed_at: pd.Timestamp) -> pd.DataFrame:
    """Nominal- or high-confidence detections from the last CONFIRM_WINDOW_H hours."""
    recent = detections["time"] >= observed_at - pd.Timedelta(hours=CONFIRM_WINDOW_H)
    return detections[recent & ~detections["low"]]


def source_rows(fire: pd.DataFrame, region: Region, keys: np.ndarray) -> pd.DataFrame:
    """Spread-model inputs for the fire's 10 km cell and its 4 edge neighbours."""
    inside = fire[fire["cell_row"] >= 0]
    if inside.empty:
        raise bundle_features.BundleError("The fire is outside the CONUS model grid")
    cells = inside.groupby(["cell_row", "cell_col"]).size()
    row, col = (int(v) for v in cells.idxmax())
    day = bundle_features.local_day(region)
    burning = {(int(r), int(c)) for r, c in cells.index}
    x, y = grid.cell_centre(row, col)
    latitude, longitude = grid.from_albers(x, y)
    season = 2 * np.pi * ((EPOCH + pd.Timedelta(days=day)).dayofyear - 1) / 365.25
    frp = inside["frp_mw"].max()
    source = {
        "src_n_fire": len(inside), "src_n_high": int(inside["high"].sum()),
        "src_frp_max": float(frp) if np.isfinite(frp) else np.nan,
        "src_n_sensors": inside["source"].nunique(),
        "src_fire_days_prev7d": int(fire_history(keys, [row], [col], [day])["firms_fire_days_prev7d"][0]),
        "src_burning_neighbours": sum((row + dr, col + dc) in burning for dr, dc in NEIGHBOURS),
        "latitude": float(latitude), "longitude": float(longitude),
        "doy_sin": float(np.sin(season)), "doy_cos": float(np.cos(season)),
    }
    targets = [(dr, dc) for dr, dc in NEIGHBOURS if dr == 0 or dc == 0]
    history = fire_history(keys, [row + dr for dr, _ in targets], [col + dc for _, dc in targets], [day] * len(targets))
    return pd.DataFrame([{**source, "adjacent": 1, "diagonal": 0,
                          "tgt_fire_days_prev7d": int(history["firms_fire_days_prev7d"][i]),
                          "tgt_fire_days_prev365d": int(history["firms_fire_days_prev365d"][i])}
                         for i in range(len(targets))])


def daily_rate(artifact: dict, rows: pd.DataFrame) -> tuple[float, float]:
    """(probability of reaching a neighbouring 10 km cell by tomorrow, mean spread in km per day)."""
    x = rows[artifact["features"]]
    model = artifact["model"]
    excess = model.predict_proba(x.assign(adjacent=1))[:, 1] - model.predict_proba(x.assign(adjacent=0))[:, 1]
    probability = float(np.clip(excess, 0.0, 1.0).mean())
    return probability, float(np.clip(mean_distance_km(probability), MIN_RATE_KM_DAY, MAX_RATE_KM_DAY))


# --- Simulation on the region grid -------------------------------------------------

def hourly_wind(bundle: dict, region: Region) -> tuple[np.ndarray, np.ndarray]:
    """(hours, rows, columns) wind speed in km/h and the direction it blows from."""
    index = bundle_features.sample_index(bundle, region)
    samples = bundle["weather_grid"]["samples"]
    hours = [bundle_features.sample_hours(s) for s in samples]
    n = max(min(len(h) for h in hours), 1)
    speed_i, from_i = (bundle_features.WEATHER_FIELDS.index(f) for f in ("wind_speed_kph", "wind_direction"))
    speed = np.stack([h[:n, speed_i] for h in hours])[index]          # (rows, columns, hours)
    direction = np.stack([h[:n, from_i] for h in hours])[index]
    return np.moveaxis(speed, -1, 0), np.moveaxis(direction, -1, 0)


def edge_rates(rate_km_h: float, fuel: np.ndarray, elevation: np.ndarray, wind_kph: np.ndarray,
               wind_from: np.ndarray, cell_km: tuple[float, float]):
    """Spread rate out of every cell towards each of its 8 neighbours, per forecast hour.

    Returns (steps, rates): `steps` are (row step, column step, distance in km)
    and `rates` is (hours, 8, rows, columns) in km/h; 0 where the neighbour is
    off the grid or cannot burn. Rows run north to south.
    """
    rows, columns = fuel.shape
    dy, dx = cell_km
    steps, rates = [], np.zeros((wind_kph.shape[0], len(NEIGHBOURS), rows, columns))
    padded_fuel = np.pad(fuel, 1, constant_values=0.0)
    padded_elevation = np.pad(elevation, 1, constant_values=np.nan)
    for k, (dr, dc) in enumerate(NEIGHBOURS):
        north, east = -dr * dy, dc * dx
        distance = float(np.hypot(north, east))
        bearing = float(np.degrees(np.arctan2(east, north)) % 360)
        target = (slice(1 + dr, 1 + dr + rows), slice(1 + dc, 1 + dc + columns))
        rise = np.nan_to_num(padded_elevation[target] - elevation, nan=0.0)
        rates[:, k] = (rate_km_h * padded_fuel[target] * slope_factor(rise, distance)
                       * wind_factor(wind_kph, wind_from, bearing))
        steps.append((dr, dc, distance))
    return steps, rates


def arrival_hours(ignited: np.ndarray, steps: list, rates: np.ndarray, limit_h: float) -> np.ndarray:
    """Earliest arrival time of fire in each cell (hours); inf where it does not arrive within `limit_h`.

    Dijkstra over the 8-neighbour grid. Each step uses the wind of the hour
    the fire leaves the cell.
    """
    rows, columns = ignited.shape
    arrival = np.full(ignited.shape, np.inf)
    arrival[ignited] = 0.0
    queue = [(0.0, int(r), int(c)) for r, c in zip(*np.nonzero(ignited))]
    heapq.heapify(queue)
    last_hour = rates.shape[0] - 1
    while queue:
        t, r, c = heapq.heappop(queue)
        if t > arrival[r, c] or t > limit_h:
            continue
        out = rates[min(int(t), last_hour), :, r, c]
        for k, (dr, dc, distance) in enumerate(steps):
            if out[k] <= 0:
                continue
            rr, cc = r + dr, c + dc
            arrived = t + distance / out[k]
            if arrived < arrival[rr, cc]:
                arrival[rr, cc] = arrived
                heapq.heappush(queue, (arrived, rr, cc))
    return arrival


def convex_hull(points: np.ndarray) -> np.ndarray:
    """Andrew's monotone chain; returns the hull vertices counter-clockwise."""
    points = np.unique(points, axis=0)
    if len(points) < 3:
        return points

    def turn(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    def half(sequence):
        hull = []
        for p in sequence:
            while len(hull) >= 2 and turn(hull[-2], hull[-1], p) <= 0:
                hull.pop()
            hull.append(p)
        return hull[:-1]

    return np.array(half(points) + half(points[::-1]))


def outline(region: Region, mask: np.ndarray) -> list:
    """GeoJSON ring around the cells in `mask`: the convex hull of their corners."""
    b = region.bounds
    dy, dx = (b["north"] - b["south"]) / region.rows, (b["east"] - b["west"]) / region.columns
    r, c = np.nonzero(mask)
    corners = np.concatenate([np.column_stack([b["west"] + (c + i) * dx, b["north"] - (r + j) * dy])
                              for i in (0, 1) for j in (0, 1)])
    hull = convex_hull(corners)
    return [[[float(x), float(y)] for x, y in [*hull, hull[0]]]]


def predict_bundle(bundle: dict, artifact: dict, archive_keys: np.ndarray) -> dict:
    """Spread outlines and per-cell burn probabilities, or `no_confirmed_fire`."""
    region = bundle_features.region_of(bundle)
    detections = bundle_features.detections_frame(bundle)
    fire = confirmed_detections(detections, region.observed_at)
    f_row, f_col = region.cell_of(fire["latitude"], fire["longitude"])
    fire, f_row, f_col = fire[f_row >= 0], f_row[f_row >= 0], f_col[f_row >= 0]
    base = {"updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "modelVersion": artifact["version"]}
    empty = {"type": "FeatureCollection", "features": []}
    if fire.empty:
        return {**base, "status": "no_confirmed_fire", "spread": empty, "cells": empty, "drivers": None}

    keys = bundle_features.merged_fire_keys(archive_keys, detections[detections["day"] < bundle_features.local_day(region)])
    probability, km_day = daily_rate(artifact, source_rows(fire, region, keys))

    ignited = np.zeros(region.shape, dtype=bool)
    ignited[f_row, f_col] = True
    fuel = fuel_factor(np.nan_to_num(bundle_features.grid_values(bundle["vegetation"]["grid"], "fuel_model_code", region), nan=-1))
    fuel[ignited] = np.maximum(fuel[ignited], 1e-3)  # a detected fire is burning whatever the fuel map says
    elevation = bundle_features.grid_values(bundle["terrain"]["grid"], "elevation_m", region)
    wind_kph, wind_from = hourly_wind(bundle, region)
    limit = max(HORIZONS_H) * 8.0  # cells past this have under 0.04% probability at 24 h
    steps, rates = edge_rates(km_day / 24.0, fuel, elevation, wind_kph, wind_from, region.cell_km)
    arrival = arrival_hours(ignited, steps, rates, limit)

    origin_lat, origin_lon = float(fire["latitude"].mean()), float(fire["longitude"].mean())
    north_km = (region.latitude - origin_lat) * bundle_features.KM_PER_DEGREE
    east_km = (region.longitude - origin_lon) * bundle_features.KM_PER_DEGREE * np.cos(np.radians(origin_lat))
    distance = np.hypot(north_km, east_km)
    spread = []
    for horizon in HORIZONS_H:
        burned = np.exp(-arrival / horizon) >= OUTLINE_PROBABILITY
        head = np.unravel_index(np.argmax(np.where(burned, distance, -1.0)), burned.shape)
        head_km = float(distance[head])
        spread.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": outline(region, burned)},
            "properties": {
                "horizonHours": horizon, "confidence": OUTLINE_PROBABILITY,
                "origin": [origin_lon, origin_lat],
                "headingDeg": round(float(np.degrees(np.arctan2(east_km[head], north_km[head])) % 360), 1),
                "rateKmh": round(head_km / horizon, 3), "headKm": round(head_km, 2),
                "areaKm2": round(float(burned.sum() * region.cell_km[0] * region.cell_km[1]), 1),
            },
        })
    cells = []
    for row, column in zip(*np.nonzero(np.isfinite(arrival))):
        t = float(arrival[row, column])
        if np.exp(-t / max(HORIZONS_H)) < 0.01:
            continue
        cells.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": bundle_features.cell_polygon(region, int(row), int(column))},
            "properties": {"arrivalHours": round(t, 2), "burning": bool(ignited[row, column]),
                           **{f"probability{h}h": round(float(np.exp(-t / h)), 4) for h in HORIZONS_H}},
        })
    weather = bundle.get("weather") or {}
    return {
        **base, "status": "ok",
        "fire": {"detections": int(len(fire)), "cells": int(ignited.sum()), "sensors": int(fire["source"].nunique()),
                 "frpMaxMw": None if fire["frp_mw"].isna().all() else float(fire["frp_mw"].max())},
        "neighbourCellProbability": round(probability, 4), "meanSpreadKmPerDay": round(km_day, 2),
        "spread": {"type": "FeatureCollection", "features": spread},
        "cells": {"type": "FeatureCollection", "features": cells},
        "drivers": {"observedAt": bundle.get("observation_time"), "temperatureC": weather.get("temperature"),
                    "relativeHumidityPct": weather.get("humidity"), "windSpeedKmh": weather.get("wind_speed_kph"),
                    "windFromDeg": weather.get("wind_direction")},
    }
