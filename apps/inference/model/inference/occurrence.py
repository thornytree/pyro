"""Model 1 at serving time: fire probability for each cell of a live bundle."""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
import pandas as pd

from harmonization import bundle_features
from harmonization.compile_dataset import DAY_SPAN, EPOCH
from model.estimators import shift_prior


def predict_frame(artifact: dict, frame: pd.DataFrame) -> dict[str, np.ndarray]:
    """Per row: `probability` (real-world rate), `score` (balanced training scale) and `uncertainty`.

    `uncertainty` is twice the standard deviation of the score across the
    bootstrap ensemble, capped at 1 (a standard deviation cannot exceed 0.5).
    """
    scores = np.stack([m.predict_proba(frame[artifact["features"]])[:, 1] for m in artifact["models"]])
    score = scores.mean(0)
    return {
        "score": score,
        "probability": shift_prior(score, artifact["sample_rate"], artifact["base_rate"]),
        "uncertainty": np.minimum(2 * scores.std(0), 1.0),
    }


def predict_bundle(bundle: dict, artifact: dict, archive_keys: np.ndarray) -> dict:
    """The `cells` part of the tile response, plus what the numbers mean."""
    filled: list = []
    region, frame = bundle_features.occurrence_features(bundle, archive_keys, filled)
    filled_mask = filled[0]
    out = predict_frame(artifact, frame)
    detections = bundle_features.detections_frame(bundle)
    d_row, d_col = region.cell_of(detections["latitude"], detections["longitude"])
    detected = np.zeros(region.shape, dtype=int)
    np.add.at(detected, (d_row[d_row >= 0], d_col[d_row >= 0]), 1)
    cells = []
    for i in range(len(frame)):
        row, column = divmod(i, region.columns)
        cells.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": bundle_features.cell_polygon(region, row, column)},
            "properties": {
                "probability": round(float(out["probability"][i]), 4),
                "uncertainty": round(float(out["uncertainty"][i]), 4),
                "riskScore": round(float(out["score"][i]), 4),
                "detections": int(detected[row, column]),
                "filled": bool(filled_mask[row, column]),
            },
        })
    archive_end = EPOCH + pd.Timedelta(days=int((archive_keys % DAY_SPAN).max())) if len(archive_keys) else None
    return {
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "modelVersion": artifact["version"],
        "predictionDate": str((EPOCH + pd.Timedelta(days=bundle_features.local_day(region) + 1)).date()),
        "baseRate": round(float(artifact["base_rate"]), 5),
        "fireHistoryThrough": None if archive_end is None else str(archive_end.date()),
        "cells": {"type": "FeatureCollection", "features": cells},
    }
