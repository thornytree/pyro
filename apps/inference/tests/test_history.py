from datetime import date
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from model.features import FEATURES
from model.inference.history import HistoryArchive
from shared import grid


class Model:
    def predict_proba(self, features):
        # Labels must never be provided as model features.
        assert list(features.columns) == FEATURES
        return np.tile([0.25, 0.75], (len(features), 1))


def test_archive_clips_real_cells_and_keeps_counts_separate(tmp_path):
    x, y = grid.cell_centre(180, 90)
    lat, lon = grid.from_albers(x, y)
    record = {key: 0.0 for key in FEATURES}
    record.update(date="2024-08-01", cell_row=180, cell_col=90, cell_id=grid.cell_id(180, 90),
                  latitude=float(lat), longitude=float(lon), fire=1, label_n_detections=12)
    path = tmp_path / "test.csv.gz"
    pd.DataFrame([record]).to_csv(path, index=False)
    predictor = SimpleNamespace(models=[Model()] * 5, metadata={"model_version": "test"})
    archive = HistoryArchive(path, predictor)
    assert archive.examples()["examples"][0]["detectionCount"] == 12
    result = archive.tile(float(lat), float(lon), date(2024, 8, 1))
    assert result["history"]["observedDetectionCount"] == 12
    assert not result["detections"]["features"]
    assert not result["perimeters"]["features"]
    assert result["cells"]["features"][0]["properties"]["probability"] == .75
    west, south, east, north = result["bounds"]
    for feature in result["cells"]["features"]:
        for px, py in feature["geometry"]["coordinates"][0]:
            assert west - 1e-9 <= px <= east + 1e-9
            assert south - 1e-9 <= py <= north + 1e-9
    with pytest.raises(ValueError, match="No archived samples"):
        archive.tile(float(lat), float(lon), date(2024, 8, 2))
