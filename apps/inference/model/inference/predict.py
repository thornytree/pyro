"""Load the fitted ensemble once and return map-compatible daily detection scores."""
from datetime import datetime, timedelta, timezone
from pathlib import Path

import joblib
import numpy as np
from threadpoolctl import threadpool_limits

from model.features import FEATURES, bundle_features, point_features
from model.schema import PointsRequest, PredictionBundle


class Predictor:
    def __init__(self, path: Path):
        artifact = joblib.load(path)
        self.models = artifact["models"]
        self.metadata = artifact["metadata"]
        if self.metadata["features"] != FEATURES or len(self.models) != 5:
            raise ValueError("Model artifact does not match the serving feature schema")

    def _score(self, features):
        """Ensemble mean and twice its standard deviation, each clipped to 0..1."""
        with threadpool_limits(limits=1):
            scores = np.asarray([model.predict_proba(features)[:, 1] for model in self.models])
        return scores.mean(axis=0), np.clip(2 * scores.std(axis=0), 0, 1)

    def _response(self, start, native_cell_count):
        return {
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "prediction": {
                "modelVersion": self.metadata["model_version"],
                "target": "any_firms_detection_in_10km_cell_day",
                "scoreKind": "sample_relative", "horizonHours": 24,
                "nativeResolutionKm": 10, "nativeCellCount": native_cell_count,
                "uncertaintyKind": "twice_bootstrap_ensemble_standard_deviation",
                "windowStart": start.isoformat(), "windowEnd": (start + timedelta(hours=24)).isoformat(),
                "experimental": True,
            },
        }

    def predict_points(self, request: PointsRequest):
        """Compact scores, one per requested point in request order (no geometry)."""
        features, native_ids, start = point_features(request)
        mean, uncertainty = self._score(features)
        return {
            "probability": [round(float(value), 4) for value in mean],
            "uncertainty": [round(float(value), 4) for value in uncertainty],
            **self._response(start, len(set(native_ids))),
        }

    def predict(self, bundle: PredictionBundle):
        features, mapping, native_ids, start = bundle_features(bundle)
        mean, uncertainty = self._score(features)
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
        return {"cells": {"type": "FeatureCollection", "features": output}, **self._response(start, len(native_ids))}
