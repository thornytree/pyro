"""Run from apps/inference: python -m pytest tests"""
import numpy as np
import pandas as pd

from harmonization.firms_cells import cell_day_counts
from shared import grid


def test_cells_nest_in_tiles_and_projection_round_trips():
    lat, lon = np.array([34.05, 47.6, 25.8]), np.array([-118.25, -122.33, -80.2])
    x, y = grid.to_albers(lat, lon)
    back_lat, back_lon = grid.from_albers(x, y)
    assert np.allclose(back_lat, lat) and np.allclose(back_lon, lon)
    row, col = grid.cell_index(x, y)
    tile_row, tile_col = grid.tile_index(x, y)
    assert (row // grid.CELLS_PER_TILE == tile_row).all()
    assert (col // grid.CELLS_PER_TILE == tile_col).all()
    assert grid.cell_id(203, 402) == "r40c80_32"


def test_cell_day_counts_uses_local_date_and_separates_non_fire():
    x, y = grid.to_albers([40.0] * 3, [-120.0] * 3)
    detections = pd.DataFrame({
        "source": "MODIS",
        # 05:00 UTC at 120 W is 21:00 the previous local day.
        "acq_datetime": ["2020-08-02T05:00:00Z", "2020-08-01T21:00:00Z", "2020-08-01T21:00:00Z"],
        "daynight": ["N", "D", "D"], "longitude": -120.0, "x": x, "y": y,
        "frp": [10.0, 30.0, 99.0], "confidence": [2, 1, 2], "type": [0, None, 2],
    })
    out = cell_day_counts(detections)
    assert len(out) == 1 and out.date[0] == "2020-08-01"
    row = out.iloc[0]
    assert (row.n_fire, row.n_fire_high, row.n_fire_day, row.n_nonfire) == (2, 1, 1, 1)
    assert (row.frp_sum, row.frp_max) == (40.0, 30.0)
