"""Sparse replay of supplied held-out cell-days; never invent hotspot locations."""
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from threadpoolctl import threadpool_limits

from model.features import FEATURES
from shared import grid


class HistoryArchive:
    def __init__(self, path: Path, predictor):
        self.path, self.predictor = path, predictor
        self._data = None

    @property
    def data(self):
        if self._data is None:
            self._data = pd.read_csv(self.path).dropna(subset=FEATURES)
        return self._data

    def examples(self):
        rows = self.data[self.data.fire == 1].sort_values("label_n_detections", ascending=False).head(20)
        return {"examples": [{"date": r.date, "lat": r.latitude, "long": r.longitude,
                               "detectionCount": int(r.label_n_detections), "split": "test"}
                              for r in rows.itertuples()]}

    def tile(self, lat: float, lon: float, day: date):
        radius = 6371.0088
        area = 300 * 1.609344 ** 2
        half_lat = np.sqrt(area) / (2 * radius)
        half_lon = area / (4 * radius ** 2 * np.cos(np.radians(lat)) * np.sin(half_lat))
        west, south = lon - np.degrees(half_lon), lat - np.degrees(half_lat)
        east, north = lon + np.degrees(half_lon), lat + np.degrees(half_lat)
        records = self.data[self.data.date == day.isoformat()]
        # Cell corners, not just centres: preserve partial coverage near the box edge.
        features, selected = [], []
        for r in records.itertuples():
            x = grid.X_MIN + r.cell_col * grid.CELL_SIZE_M
            y = grid.Y_MIN + r.cell_row * grid.CELL_SIZE_M
            ys, xs = grid.from_albers([x, x + 10000, x + 10000, x, x], [y, y, y + 10000, y + 10000, y])
            ring = list(zip(xs.tolist(), ys.tolist()))
            # Clip native projected-cell polygon to requested geographic rectangle.
            for axis, edge, lower in [(0, west, True), (0, east, False), (1, south, True), (1, north, False)]:
                output = []
                if not ring:
                    break
                previous = ring[-1]
                for current in ring:
                    a = previous[axis] >= edge if lower else previous[axis] <= edge
                    b = current[axis] >= edge if lower else current[axis] <= edge
                    if a != b:
                        t = (edge - previous[axis]) / (current[axis] - previous[axis])
                        output.append(tuple(previous[k] + t * (current[k] - previous[k]) for k in (0, 1)))
                    if b:
                        output.append(current)
                    previous = current
                ring = output
            if len(ring) < 3:
                continue
            if ring[-1] != ring[0]:
                ring.append(ring[0])
            selected.append(r.Index)
            features.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]},
                             "properties": {"nativeCellId": r.cell_id, "observedFire": bool(r.fire),
                                            "observedDetectionCount": int(r.label_n_detections)}})
        if not selected:
            raise ValueError("No archived samples cover this area and date. Open an available historical example.")
        with threadpool_limits(limits=1):
            scores = np.asarray([m.predict_proba(self.data.loc[selected, FEATURES])[:, 1] for m in self.predictor.models])
        for i, feature in enumerate(features):
            feature["properties"].update(probability=float(scores[:, i].mean()), uncertainty=float(np.clip(2 * scores[:, i].std(), 0, 1)))
        empty = {"type": "FeatureCollection", "features": []}
        start = f"{day.isoformat()}T00:00:00Z"
        return {"tileId": f"history-{lat:.5f}-{lon:.5f}-{day}", "status": "ready",
                "bounds": [west, south, east, north], "updatedAt": start,
                "cells": {"type": "FeatureCollection", "features": features}, "detections": empty,
                "perimeters": empty, "history": {"date": day.isoformat(), "split": "test",
                "coverage": "sampled_cells_only", "weather": "retrospective_daily",
                "observedDetectionCount": sum(f["properties"]["observedDetectionCount"] for f in features),
                "message": "Held-out sampled cell-days only. Counts refer to full native cells, including cells clipped at the region edge. Exact hotspots and perimeters are not included. Unshaded areas have no archive sample."},
                "prediction": {"modelVersion": self.predictor.metadata["model_version"],
                "target": "any_firms_detection_in_10km_cell_day", "scoreKind": "sample_relative", "horizonHours": 24,
                "nativeResolutionKm": 10, "nativeCellCount": len(features), "experimental": True,
                "uncertaintyKind": "twice_bootstrap_ensemble_standard_deviation",
                "windowStart": start, "windowEnd": f"{date.fromordinal(day.toordinal()+1)}T00:00:00Z"}}
