"""Run from apps/inference: python -m pytest tests"""
import io

import numpy as np
import pandas as pd

from shared import grid
from sources.firms.normalize import RAW_TEXT_COLUMNS, dedupe, normalize

# Real rows from the 2026-11-14 archive download, one block per file layout.
MODIS_ARCHIVE = """latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type
38.5586,-78.317,302.3,2.8,1.6,2000-11-01,0250,Terra,MODIS,45,6.03,279.8,36,N,0
38.5451,-78.3107,309.9,2.8,1.6,2000-11-01,0250,Terra,MODIS,79,6.03,280.7,58.8,N,0
"""
VIIRS_NRT = """latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight
19.40883,-155.28764,367,0.34,0.56,2026-08-01,0009,N21,VIIRS,h,2.0NRT,324.75,10.83,D
41.97342,-75.94317,298.61,0.35,0.57,2026-08-01,0622,SNPP,SNPP,n,2.0NRT,283.45,0.29,N
"""
LANDSAT = """latitude,longitude,scan,track,acq_date,acq_time,satellite,instrument,confidence,daynight
38.222149,-85.844039,290,6444,2022-06-20,1617,L8,OLI,L,D
38.222149,-85.844039,1440,1134,2022-06-20,1617,L8,OLI,H,D
"""


def read(text: str) -> pd.DataFrame:
    return pd.read_csv(io.StringIO(text), dtype={c: str for c in RAW_TEXT_COLUMNS})


def test_modis_archive_row():
    row = normalize(read(MODIS_ARCHIVE)).iloc[0]
    assert (row.source, row.satellite, row.quality) == ("MODIS", "Terra", "sp")
    assert row.acq_datetime == pd.Timestamp("2000-11-01 02:50", tz="UTC")
    assert (row.confidence, row.confidence_pct, row.type) == (1, 45.0, 0)
    assert np.isclose(row.brightness, 302.3) and np.isclose(row.brightness_2, 279.8)


def test_viirs_nrt_rows():
    out = normalize(read(VIIRS_NRT))
    assert list(out.source) == ["VIIRS_NOAA21", "VIIRS_SNPP"]
    assert list(out.quality) == ["nrt", "nrt"]
    assert list(out.confidence) == [2, 1]
    assert out.confidence_pct.isna().all() and out.type.isna().all()
    # Leading zeros in acq_time survive: 0009 is nine minutes past midnight.
    assert out.acq_datetime[0] == pd.Timestamp("2026-08-01 00:09", tz="UTC")
    # Hawaii is outside the CONUS tile frame; Pennsylvania is inside.
    assert pd.isna(out.tile_id[0]) and out.tile_id[1] == "r40c80"


def test_landsat_fills_missing_columns_and_dedupes_scene_overlap():
    out = normalize(read(LANDSAT))
    assert (out.source == "LANDSAT").all() and (out.quality == "nrt").all()
    assert out.brightness.isna().all() and out.frp.isna().all()
    assert np.allclose(out.scan, 0.03)
    kept = dedupe(out)
    assert len(kept) == 1 and kept.confidence[0] == 2


def test_api_column_names_are_accepted():
    api = VIIRS_NRT.replace("brightness", "bright_ti4").replace("bright_t31", "bright_ti5")
    pd.testing.assert_frame_equal(normalize(read(api)), normalize(read(VIIRS_NRT)))


def test_science_quality_replaces_nrt():
    both = MODIS_ARCHIVE + "38.5586,-78.317,301.9,2.8,1.6,2000-11-01,0250,Terra,MODIS,40,6.1NRT,279.8,35,N,\n"
    kept = dedupe(normalize(read(both)))
    assert len(kept) == 2 and set(kept.quality) == {"sp"}


def test_albers_projection():
    assert np.allclose(grid.to_albers(23.0, -96.0), (0.0, 0.0), atol=1e-6)
    # Scale along a standard parallel is exactly 1.
    step = 1e-6
    for lat in (29.5, 45.5):
        (x1, x2), (y1, y2) = grid.to_albers([lat, lat], [-100.0, -100.0 + step])
        true = grid._A * grid._m(np.radians(lat)) * np.radians(step)
        assert np.isclose(np.hypot(x2 - x1, y2 - y1) / true, 1.0, atol=1e-6)


def test_tiles_are_50_km_and_frame_holds_conus_extremes():
    extremes = [(48.16, -124.73), (49.38, -95.15), (44.815, -66.95), (24.52, -81.96), (25.84, -97.40)]
    for lat, lon in extremes:
        x, y = grid.to_albers(lat, lon)
        row, col = grid.tile_index(x, y)
        assert row >= 0 and col >= 0
        x0, y0, x1, y1 = grid.tile_bounds(int(row), int(col))
        assert x0 <= x < x1 and y0 <= y < y1 and x1 - x0 == y1 - y0 == 50_000
