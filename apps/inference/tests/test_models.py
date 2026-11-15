"""Tests for the bundle features, the occurrence model plumbing and the spread model."""
import numpy as np
import pandas as pd
import pytest
from sklearn.linear_model import LogisticRegression

from harmonization import bundle_features
from harmonization import compile_dataset as compiled
from model import features
from model.estimators import make_occurrence_estimator, shift_prior
from model.inference import occurrence, spread
from model.training import train_spread
from model.training.fire_days import has_fire
from tests.bundles import make_bundle

NO_HISTORY = np.array([], dtype="int64")


class FixedSpread:
    """Stands in for the trained spread classifier: adjacent targets burn at `near`, controls at `far`."""

    def __init__(self, near=0.12, far=0.02):
        self.near, self.far = near, far

    def predict_proba(self, x):
        p = np.where(x["adjacent"] == 1, self.near, self.far)
        return np.column_stack([1 - p, p])


def spread_artifact(**rates):
    return {"model": FixedSpread(**rates), "features": features.SPREAD_FEATURES, "version": "test"}


def occurrence_artifact():
    rng = np.random.default_rng(0)
    frame = pd.DataFrame(rng.normal(size=(200, len(features.OCCURRENCE_FEATURES))), columns=features.OCCURRENCE_FEATURES)
    frame[features.FIRE_HISTORY] = rng.integers(0, 5, (200, len(features.FIRE_HISTORY)))
    frame["om_precip_sum"] = rng.random(200)
    y = (frame["om_vpd_max"] + rng.normal(size=200) > 0).astype(int)
    models = [make_occurrence_estimator("logistic", s).fit(frame.sample(200, replace=True, random_state=s), y)
              for s in range(3)]
    return {"models": models, "features": features.OCCURRENCE_FEATURES, "sample_rate": 0.5, "base_rate": 0.01,
            "version": "test"}


# --- Bundle features ---------------------------------------------------------------

def test_weather_summary_matches_the_training_features():
    rng = np.random.default_rng(1)
    hours = np.column_stack([rng.normal(20, 5, 24), rng.uniform(10, 90, 24), rng.uniform(0, 4, 24),
                             rng.uniform(0, 1, 24), rng.uniform(0, 40, 24), rng.uniform(0, 60, 24),
                             rng.uniform(0, 360, 24)])
    live = bundle_features.weather_summary(hours)
    temp, rh, vpd, rain, wind, gust, direction = hours.T
    block = np.zeros((1, len(compiled.HOURLY), 168))
    for name, values in (("temperature_2m", temp), ("relative_humidity_2m", rh), ("vapour_pressure_deficit", vpd),
                         ("precipitation", rain), ("wind_speed_10m", wind / 3.6), ("wind_gusts_10m", gust / 3.6),
                         ("wind_direction_10m", direction)):
        block[0, compiled.HOURLY.index(name), 144:] = values
    trained = compiled.hourly_features(block)
    for column in features.WEATHER:
        assert np.isclose(live[column], trained[column][0]), column


def test_occurrence_features_cover_every_cell_and_column():
    region, frame = bundle_features.occurrence_features(make_bundle(), NO_HISTORY)
    assert frame.shape == (28 * 28, len(features.OCCURRENCE_FEATURES))
    assert list(frame.columns) == features.OCCURRENCE_FEATURES
    assert not frame.isna().any().any()
    assert 0.9 < region.cell_km[0] < 1.1 and 0.9 < region.cell_km[1] < 1.1
    assert (frame["firms_days_since_fire"] == compiled.SINCE_CAP).all()


def test_flat_terrain_counts_as_flat():
    _, frame = bundle_features.occurrence_features(make_bundle(slope=0.0), NO_HISTORY)
    assert (frame["topo_flat_frac"] == 1).all() and (frame["topo_northness"] == 0).all()


def test_bundle_detections_become_fire_history():
    bundle = make_bundle(detections=[(39.0, -121.0, "VIIRS_SNPP_NRT", "nominal")])
    _, frame = bundle_features.occurrence_features(bundle, NO_HISTORY)
    assert frame["firms_fire_days_prev1d"].max() == 1
    assert frame["firms_neighbour_fire_days_prev1d"].max() == 1


def test_cells_missing_terrain_take_it_from_their_neighbours():
    bundle = make_bundle()
    cells = bundle["terrain"]["grid"]["cells"]
    for i in range(0, 28 * 5):          # the top five rows have no 3DEP values
        cells[i] = {**cells[i], "elevation_m": None, "slope_degrees": None, "aspect_degrees": None}
    filled = []
    _, frame = bundle_features.occurrence_features(bundle, NO_HISTORY, filled)
    assert not frame.isna().any().any()
    assert frame.shape == (28 * 28, len(features.OCCURRENCE_FEATURES))


def test_cells_outside_the_model_grid_use_the_nearest_inside_cell():
    # Straddles the northern edge of the CONUS frame: some cells fall outside it.
    from shared import grid
    lat, _ = grid.from_albers(-1_000_000.0, grid.Y_MAX - 5_000.0)
    bundle = make_bundle(lat=float(lat), lon=-110.0)
    filled = []
    _, frame = bundle_features.occurrence_features(bundle, NO_HISTORY, filled)
    assert not frame.isna().any().any()
    assert filled[0].any() and not filled[0].all()


def test_predict_bundle_marks_filled_cells():
    bundle = make_bundle()
    cells = bundle["terrain"]["grid"]["cells"]
    cells[0] = {**cells[0], "elevation_m": None, "slope_degrees": None, "aspect_degrees": None}
    out = occurrence.predict_bundle(bundle, occurrence_artifact(), NO_HISTORY)
    flags = [f["properties"]["filled"] for f in out["cells"]["features"]]
    assert flags[0] and sum(flags) == 1


def test_a_bundle_without_a_weather_grid_is_rejected():
    bundle = make_bundle()
    del bundle["weather_grid"]
    with pytest.raises(bundle_features.BundleError):
        bundle_features.occurrence_features(bundle, NO_HISTORY)


# --- Occurrence ----------------------------------------------------------------------

def test_shift_prior_keeps_the_rate_it_was_trained_at_and_lowers_rarer_ones():
    assert np.isclose(shift_prior(0.3, 0.5, 0.5), 0.3)
    assert np.isclose(shift_prior(0.5, 0.5, 0.01), 0.01)
    assert np.isclose(shift_prior(0.9, 0.5, 0.01), 9 * 0.01 / (9 * 0.01 + 0.99))


def test_predict_bundle_returns_one_cell_per_grid_cell():
    bundle = make_bundle(detections=[(39.0, -121.0, "VIIRS_SNPP_NRT", "nominal")])
    out = occurrence.predict_bundle(bundle, occurrence_artifact(), NO_HISTORY)
    cells = out["cells"]["features"]
    assert len(cells) == 28 * 28 and out["predictionDate"] == "2025-08-16"
    for cell in cells:
        p = cell["properties"]
        assert 0 <= p["probability"] <= p["riskScore"] <= 1 and 0 <= p["uncertainty"] <= 1
    assert sum(c["properties"]["detections"] for c in cells) == 1
    ring = cells[0]["geometry"]["coordinates"][0]
    assert ring[0] == ring[-1] and len(ring) == 5


# --- Spread: training pieces ---------------------------------------------------------

def test_build_pairs_labels_next_day_fire_and_skips_targets_already_burning():
    day = 9000
    cells = [(100, 100, day), (100, 101, day + 1), (101, 100, day), (105, 100, day + 1)]
    keys = np.sort(compiled.pack(*map(np.array, zip(*cells))))
    sources = pd.DataFrame({"cell_row": [100], "cell_col": [100], "day": [day], "weight": [1.0]})
    pairs = train_spread.build_pairs(keys, sources)
    near, far = pairs[pairs["adjacent"] == 1], pairs[pairs["adjacent"] == 0]
    assert len(near) == 7 and len(far) == 8          # (101, 100) is already burning
    assert near.loc[(near["d_row"] == 0) & (near["d_col"] == 1), "spread"].item() == 1
    assert near["spread"].sum() == 1
    assert far.loc[(far["d_row"] == 1) & (far["d_col"] == 0), "spread"].item() == 1
    assert has_fire(keys, [100, 100], [100, 100], [day, day + 1]).tolist() == [True, False]


def test_logistic_offset_fit_recovers_known_coefficients():
    rng = np.random.default_rng(2)
    x = np.column_stack([np.ones(40_000), rng.normal(size=40_000)])
    offset = rng.normal(-1, 0.5, 40_000)
    y = (rng.random(40_000) < 1 / (1 + np.exp(-(offset + x @ np.array([0.3, -0.7]))))).astype(float)
    beta, error = train_spread.fit_logistic_offset(x, y, offset)
    assert np.allclose(beta, [0.3, -0.7], atol=0.06) and (error < 0.05).all()


# --- Spread: simulation -----------------------------------------------------------------

def test_mean_distance_inverts_the_crossing_probability():
    for mean in (0.2, 1.0, 5.0, 30.0):
        p = mean / 10 * (1 - np.exp(-10 / mean))
        assert np.isclose(spread.mean_distance_km(p), mean, rtol=1e-3)
    assert spread.mean_distance_km(0.02) < spread.mean_distance_km(0.1)


def test_wind_factor_averages_one_and_peaks_downwind():
    bearings = np.arange(0, 360, 0.5)
    for wind in (0.0, 15.0, 60.0):
        factor = spread.wind_factor(wind, 270.0, bearings)   # wind from the west blows east
        assert np.isclose(factor.mean(), 1.0, atol=0.01)
        assert bearings[factor.argmax()] == 90.0 or wind == 0.0
    assert np.allclose(spread.wind_factor(0.0, 270.0, bearings), 1.0)


def _simulate(wind_kph=0.0, fuel=None, elevation=None, limit=1e9):
    shape = (21, 21)
    ignited = np.zeros(shape, dtype=bool)
    ignited[10, 10] = True
    steps, rates = spread.edge_rates(
        1.0, np.ones(shape) if fuel is None else fuel, np.zeros(shape) if elevation is None else elevation,
        np.full((1, *shape), wind_kph), np.full((1, *shape), 270.0), (1.0, 1.0))
    return spread.arrival_hours(ignited, steps, rates, limit)


def test_fire_spreads_evenly_without_wind_or_slope():
    arrival = _simulate()
    assert arrival[10, 10] == 0
    assert np.isclose(arrival[10, 15], 5.0) and np.isclose(arrival[10, 5], 5.0) and np.isclose(arrival[5, 10], 5.0)
    assert np.isclose(arrival[13, 13], 3 * np.sqrt(2))


def test_fire_runs_downwind_and_uphill():
    windy = _simulate(wind_kph=30.0)
    assert windy[10, 15] < windy[10, 5] and windy[10, 15] < 5.0     # wind from the west: east first
    assert np.isclose(windy[5, 10], windy[15, 10])                   # the flanks stay symmetric
    rising_north = np.repeat((np.arange(21)[::-1] * 100.0)[:, None], 21, axis=1)  # row 0 (north) is highest
    hilly = _simulate(elevation=rising_north)
    assert hilly[5, 10] < hilly[15, 10]


def test_non_burnable_cells_block_the_fire():
    fuel = np.ones((21, 21))
    fuel[:, 12] = 0.0                                                # a north-south river east of the fire
    arrival = _simulate(fuel=fuel)
    assert np.isinf(arrival[:, 12:]).all() and np.isfinite(arrival[:, :12]).all()
    assert spread.fuel_factor(np.array([98, 101, 185, -1])).tolist() == [0.0, 1.6, 0.4, 1.0]


def test_no_spread_without_a_confirmed_detection():
    quiet = spread.predict_bundle(make_bundle(), spread_artifact(), NO_HISTORY)
    assert quiet["status"] == "no_confirmed_fire" and quiet["spread"]["features"] == []
    low = make_bundle(detections=[(39.0, -121.0, "VIIRS_SNPP_NRT", "low")])
    assert spread.predict_bundle(low, spread_artifact(), NO_HISTORY)["status"] == "no_confirmed_fire"


def test_spread_outlines_grow_with_the_horizon_and_lean_downwind():
    bundle = make_bundle(wind_kph=25.0, wind_from=270.0, slope=0.0,
                         detections=[(39.0, -121.0, "VIIRS_SNPP_NRT", "high"), (39.0, -121.0, "MODIS_NRT", "nominal")])
    for cell in bundle["terrain"]["grid"]["cells"]:
        cell["elevation_m"] = 100.0
    out = spread.predict_bundle(bundle, spread_artifact(near=0.3, far=0.02), NO_HISTORY)
    assert out["status"] == "ok" and out["fire"] == {"detections": 2, "cells": 1, "sensors": 2, "frpMaxMw": 40.0}
    six, twelve, day = (f["properties"] for f in out["spread"]["features"])
    assert [six["horizonHours"], twelve["horizonHours"], day["horizonHours"]] == [6, 12, 24]
    assert six["areaKm2"] <= twelve["areaKm2"] <= day["areaKm2"] and day["headKm"] > six["headKm"]
    assert 60 < day["headingDeg"] < 120                              # east, with the wind
    assert np.isclose(out["meanSpreadKmPerDay"], spread.mean_distance_km(0.28), atol=0.01)
    burning = [c for c in out["cells"]["features"] if c["properties"]["burning"]]
    assert len(burning) == 1 and burning[0]["properties"]["probability24h"] == 1.0
    for feature in out["spread"]["features"]:
        ring = feature["geometry"]["coordinates"][0]
        assert ring[0] == ring[-1] and len(ring) >= 5


def test_a_stronger_fire_spreads_further():
    bundle = make_bundle(detections=[(39.0, -121.0, "VIIRS_SNPP_NRT", "high")])
    weak = spread.predict_bundle(bundle, spread_artifact(near=0.03), NO_HISTORY)
    strong = spread.predict_bundle(bundle, spread_artifact(near=0.4), NO_HISTORY)
    assert strong["meanSpreadKmPerDay"] > weak["meanSpreadKmPerDay"]
    assert strong["spread"]["features"][2]["properties"]["areaKm2"] > weak["spread"]["features"][2]["properties"]["areaKm2"]
