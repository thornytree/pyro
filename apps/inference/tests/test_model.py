"""Serving/feature parity tests; tiny test artifacts do not require private training files."""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sklearn.linear_model import LogisticRegression
from threadpoolctl import threadpool_limits

from app import create_app
from harmonization.compile_dataset import HOURLY, hourly_features
from model.features import FEATURES, bundle_features, weather_features
from model.schema import PredictionBundle


def bundle():
    start = datetime(2025, 7, 1, tzinfo=timezone.utc)
    hours = [{
        "time": (start + timedelta(hours=i)).isoformat(), "temperature": float(i),
        "humidity": 40, "wind_speed_kph": 36, "wind_gusts_kph": 54,
        "wind_direction": 90, "precipitation_mm": 0.5, "vapour_pressure_deficit_kpa": 1,
    } for i in range(24)]
    return {
        "location": {"latitude": 34.05, "longitude": -118.25}, "observation_time": start.isoformat(),
        "weather_grid": {
            "bounds": {"west": -118.26, "east": -118.24, "south": 34.04, "north": 34.06},
            "rows": 2, "columns": 2,
            "cells": [{"latitude": lat, "longitude": lon, "sample_index": 0}
                      for lat in (34.055, 34.045) for lon in (-118.255, -118.245)],
            "samples": [{"elevation_m": 100, "hourly": hours}],
        },
    }


def test_live_daily_features_match_compiler_units_and_statistics():
    parsed = PredictionBundle.model_validate(bundle())
    actual = weather_features(parsed.weather_grid.samples[0].hourly, 100)
    hourly = np.zeros((1, len(HOURLY), 168))
    values = {"temperature_2m": np.arange(24), "relative_humidity_2m": 40,
              "vapour_pressure_deficit": 1, "precipitation": 0.5,
              "wind_speed_10m": 10, "wind_gusts_10m": 15, "wind_direction_10m": 90}
    for name, value in values.items():
        hourly[0, HOURLY.index(name), -24:] = value
    expected = hourly_features(hourly)
    for key in FEATURES[5:]:
        assert np.isclose(actual[key], expected[key][0]), key
    assert actual["om_wind_mean"] == 10
    assert actual["om_precip_sum"] == 12


def test_features_do_not_use_label_or_same_day_fire_data():
    original = bundle()
    first = bundle_features(PredictionBundle.model_validate(original))[0]
    original["fire"] = {"detections": [{"frp_mw": 99999}] * 100}
    original["historical_weather"] = {"arbitrary_old_climate": 999999}
    second = bundle_features(PredictionBundle.model_validate(original))[0]
    pd.testing.assert_frame_equal(first, second)
    assert not any(name.startswith(("label_", "firms_", "dm_")) for name in FEATURES)


@pytest.fixture
def artifact(tmp_path):
    rng = np.random.default_rng(1)
    frame = pd.DataFrame(rng.normal(size=(80, len(FEATURES))), columns=FEATURES)
    labels = (frame["om_temp_mean"] > 0).astype(int)
    with threadpool_limits(limits=1):
        models = [LogisticRegression().fit(frame, labels) for _ in range(5)]
    path = tmp_path / "test.joblib"
    joblib.dump({"models": models, "metadata": {
        "features": FEATURES, "model_version": "test-v1", "target": "any_firms_detection_in_10km_cell_day",
    }}, path)
    return path


def test_api_loads_artifact_once_and_returns_geographic_scores(artifact):
    with TestClient(create_app(artifact)) as client:
        assert client.get("/health").json()["modelVersion"] == "test-v1"
        response = client.post("/predict", json=bundle())
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["prediction"]["scoreKind"] == "sample_relative"
        assert result["prediction"]["nativeResolutionKm"] == 10
        features = result["cells"]["features"]
        assert len(features) == 4
        assert features[0]["geometry"]["coordinates"][0][0] == [-118.26, 34.05]
        by_native = {}
        for feature in features:
            props = feature["properties"]
            assert 0 <= props["probability"] <= 1 and 0 <= props["uncertainty"] <= 1
            assert by_native.setdefault(props["nativeCellId"], props["probability"]) == props["probability"]
        bad = bundle()
        bad["weather_grid"]["samples"][0]["hourly"].pop()
        assert client.post("/predict", json=bad).status_code == 422
        bad = bundle()
        bad["weather_grid"]["cells"][0]["sample_index"] = 100
        assert client.post("/predict", json=bad).status_code == 422
        bad = bundle()
        bad["weather_grid"]["samples"][0]["hourly"][0]["humidity"] = 150
        assert client.post("/predict", json=bad).status_code == 422
