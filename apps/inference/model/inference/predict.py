"""Load the fitted ensemble once and return map-compatible daily detection scores."""
from datetime import datetime, timedelta, timezone
from pathlib import Path

import joblib
import numpy as np
from threadpoolctl import threadpool_limits

from model.features import FEATURES, bundle_features
from model.schema import PredictionBundle


class Predictor:
    def __init__(self, path: Path):
        artifact = joblib.load(path)
        self.models = artifact["models"]
        self.metadata = artifact["metadata"]
        if self.metadata["features"] != FEATURES or len(self.models) != 5:
            raise ValueError("Model artifact does not match the serving feature schema")

    def predict(self, bundle: PredictionBundle):
        features, mapping, native_ids, start = bundle_features(bundle)
        with threadpool_limits(limits=1):
            scores = np.asarray([model.predict_proba(features)[:, 1] for model in self.models])
        mean = scores.mean(axis=0)
        uncertainty = np.clip(2 * scores.std(axis=0), 0, 1)
        g = bundle.weather_grid
        dx = (g.bounds.east - g.bounds.west) / g.columns
        dy = (g.bounds.north - g.bounds.south) / g.rows
        output = []
        for index, native in enumerate(mapping):
            row, col = divmod(index, g.columns)
            west, north = g.bounds.west + col * dx, g.bounds.north - row * dy
            east, south = west + dx, north - dy
            output.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [[[west, south], [east, south], [east, north], [west, north], [west, south]]]},
                "properties": {
                    "probability": float(mean[native]),  # Legacy map field; semantics specified below.
                    "uncertainty": float(uncertainty[native]), "nativeCellId": native_ids[native],
                },
            })
        return {
            "cells": {"type": "FeatureCollection", "features": output},
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "prediction": {
                "modelVersion": self.metadata["model_version"],
                "target": "any_firms_detection_in_10km_cell_day",
                "scoreKind": "sample_relative", "horizonHours": 24,
                "nativeResolutionKm": 10, "nativeCellCount": len(native_ids),
                "uncertaintyKind": "twice_bootstrap_ensemble_standard_deviation",
                "windowStart": start.isoformat(), "windowEnd": (start + timedelta(hours=24)).isoformat(),
                "experimental": True,
            },
        }
