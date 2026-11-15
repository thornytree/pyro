"""Project grid: fixed 50 km tiles over CONUS in EPSG:5070.

EPSG:5070 (NAD83 / CONUS Albers Equal Area Conic) is what LANDFIRE ships in,
and equal-area means every tile covers the same ground. The projection is
implemented here in numpy so the pipeline needs no PROJ install.

Input coordinates are treated as NAD83. FIRMS reports WGS84; the two differ
by about a metre over CONUS, far below a 375 m pixel.

The projection choice and the frame are still an open team question (see
docs/handover/risks-and-open-questions.md). Everything that depends on them
reads the constants below, so changing them here re-tiles the whole pipeline.
"""
from __future__ import annotations

import numpy as np

# GRS80 ellipsoid
_A = 6378137.0
_F = 1 / 298.257222101
_E2 = _F * (2 - _F)
_E = np.sqrt(_E2)

# EPSG:5070 parameters
_LAT_1, _LAT_2, _LAT_0, _LON_0 = 29.5, 45.5, 23.0, -96.0

TILE_SIZE_M = 50_000
# Frame in EPSG:5070 metres. Covers the lower 48 with margin; it also takes in
# strips of Canada, Mexico and ocean, which simply never get detections.
X_MIN, Y_MIN = -2_400_000, 250_000
N_COLS, N_ROWS = 95, 59
X_MAX = X_MIN + N_COLS * TILE_SIZE_M
Y_MAX = Y_MIN + N_ROWS * TILE_SIZE_M


def _q(sin_lat):
    return (1 - _E2) * (
        sin_lat / (1 - _E2 * sin_lat**2)
        - np.log((1 - _E * sin_lat) / (1 + _E * sin_lat)) / (2 * _E)
    )


def _m(lat_rad):
    return np.cos(lat_rad) / np.sqrt(1 - _E2 * np.sin(lat_rad) ** 2)


_Q1, _Q2, _Q0 = (_q(np.sin(np.radians(v))) for v in (_LAT_1, _LAT_2, _LAT_0))
_M1, _M2 = _m(np.radians(_LAT_1)), _m(np.radians(_LAT_2))
_N = (_M1**2 - _M2**2) / (_Q2 - _Q1)
_C = _M1**2 + _N * _Q1
_RHO_0 = _A * np.sqrt(_C - _N * _Q0) / _N


def to_albers(latitude, longitude):
    """Degrees to EPSG:5070 metres. Returns (x, y) as float64 arrays."""
    lat = np.radians(np.asarray(latitude, dtype="float64"))
    dlon = (np.asarray(longitude, dtype="float64") - _LON_0 + 180.0) % 360.0 - 180.0
    rho = _A * np.sqrt(_C - _N * _q(np.sin(lat))) / _N
    theta = _N * np.radians(dlon)
    return rho * np.sin(theta), _RHO_0 - rho * np.cos(theta)


def tile_index(x, y):
    """EPSG:5070 metres to (row, col). Row 0 is the southernmost row.

    Points outside the frame get -1 for both.
    """
    x = np.asarray(x, dtype="float64")
    y = np.asarray(y, dtype="float64")
    col = np.floor((x - X_MIN) / TILE_SIZE_M)
    row = np.floor((y - Y_MIN) / TILE_SIZE_M)
    inside = (col >= 0) & (col < N_COLS) & (row >= 0) & (row < N_ROWS)
    return (
        np.where(inside, row, -1).astype("int16"),
        np.where(inside, col, -1).astype("int16"),
    )


def tile_id(row: int, col: int) -> str:
    """The shareable location ID, e.g. 'r12c34'."""
    return f"r{row:02d}c{col:02d}"


def tile_bounds(row: int, col: int) -> tuple[float, float, float, float]:
    """(x_min, y_min, x_max, y_max) of a tile in EPSG:5070 metres."""
    x0 = X_MIN + col * TILE_SIZE_M
    y0 = Y_MIN + row * TILE_SIZE_M
    return x0, y0, x0 + TILE_SIZE_M, y0 + TILE_SIZE_M


# --- Model cells -------------------------------------------------------------
# 10 km cells, 5 x 5 per tile, on the same frame as the tiles (chosen
# 2026-11-14: it matches the 25 weather points per tile the orchestrator
# samples). Cells are addressed by a global (row, col); row 0 is the south.
CELL_SIZE_M = 10_000
CELLS_PER_TILE = TILE_SIZE_M // CELL_SIZE_M
N_CELL_COLS, N_CELL_ROWS = N_COLS * CELLS_PER_TILE, N_ROWS * CELLS_PER_TILE


def cell_index(x, y):
    """EPSG:5070 metres to global cell (row, col); -1 for both outside the frame."""
    x = np.asarray(x, dtype="float64")
    y = np.asarray(y, dtype="float64")
    col = np.floor((x - X_MIN) / CELL_SIZE_M)
    row = np.floor((y - Y_MIN) / CELL_SIZE_M)
    inside = (col >= 0) & (col < N_CELL_COLS) & (row >= 0) & (row < N_CELL_ROWS)
    return (
        np.where(inside, row, -1).astype("int16"),
        np.where(inside, col, -1).astype("int16"),
    )


def cell_id(row: int, col: int) -> str:
    """Tile ID plus the cell's position inside it, e.g. 'r12c34_03'."""
    return (
        f"{tile_id(row // CELLS_PER_TILE, col // CELLS_PER_TILE)}"
        f"_{row % CELLS_PER_TILE}{col % CELLS_PER_TILE}"
    )


def cell_centre(row, col):
    """Global cell (row, col) to the cell centre in EPSG:5070 metres."""
    return (
        X_MIN + (np.asarray(col, dtype="float64") + 0.5) * CELL_SIZE_M,
        Y_MIN + (np.asarray(row, dtype="float64") + 0.5) * CELL_SIZE_M,
    )


def from_albers(x, y):
    """EPSG:5070 metres to (latitude, longitude) in degrees. Inverse of to_albers."""
    x = np.asarray(x, dtype="float64")
    dy = _RHO_0 - np.asarray(y, dtype="float64")
    q = (_C - (np.hypot(x, dy) * _N / _A) ** 2) / _N
    lat = np.arcsin(np.clip(q / 2, -1, 1))
    for _ in range(6):  # converges to well under a millimetre
        s = np.sin(lat)
        lat = lat + (1 - _E2 * s**2) ** 2 / (2 * np.cos(lat)) * (
            q / (1 - _E2)
            - s / (1 - _E2 * s**2)
            + np.log((1 - _E * s) / (1 + _E * s)) / (2 * _E)
        )
    return np.degrees(lat), _LON_0 + np.degrees(np.arctan2(x, dy) / _N)
