"""Unified FIRMS detection schema, shared by the archive loader and the live fetcher.

One row is one detection from one sensor. Detections of the same fire by
different sensors are kept as separate rows: the model treats each sensor as
an independent witness.
"""
from __future__ import annotations

# Values of the `source` column.
SOURCES = ("MODIS", "VIIRS_SNPP", "VIIRS_NOAA20", "VIIRS_NOAA21", "LANDSAT")

# Values of the `quality` column, best first. When the same detection exists
# at two quality levels, the better one is kept.
#   sp  = science quality (archive "standard processing")
#   nrt = near real time, rt = real time, urt = ultra real time
QUALITIES = ("sp", "nrt", "rt", "urt")

# `confidence` is an ordinal class every sensor can be mapped to without
# inventing numbers. MODIS's 0-100 value is kept alongside in `confidence_pct`.
CONFIDENCE_LOW, CONFIDENCE_NOMINAL, CONFIDENCE_HIGH = 0, 1, 2
# FIRMS's own classes for the MODIS 0-100 value: low < 30 <= nominal < 80 <= high.
MODIS_NOMINAL_MIN, MODIS_HIGH_MIN = 30, 80

# Landsat's scan/track columns are pixel positions in the scene, not pixel
# sizes, so the unified scan/track use the nominal 30 m pixel instead.
LANDSAT_PIXEL_KM = 0.03

# Archive `type` codes (absent from NRT and Landsat files, so null there).
TYPE_VEGETATION_FIRE, TYPE_VOLCANO, TYPE_STATIC_LAND, TYPE_OFFSHORE = 0, 1, 2, 3

# Column -> pandas dtype, in output order.
COLUMNS = {
    "source": "category",          # one of SOURCES
    "satellite": "category",       # Terra, Aqua, SNPP, N20, N21, L8, L9
    "quality": "category",         # one of QUALITIES
    "version": "category",         # as delivered, e.g. 6.03, 61.03, 2, 2.0NRT; null for Landsat
    "acq_datetime": "datetime64[ns, UTC]",
    "daynight": "category",        # D or N
    "latitude": "float64",         # pixel centre, WGS84 degrees
    "longitude": "float64",
    "x": "float64",                # EPSG:5070 metres (shared/grid.py)
    "y": "float64",
    "tile_id": "category",         # 50 km tile, null outside the CONUS frame
    "scan": "float32",             # pixel size across track, km
    "track": "float32",            # pixel size along track, km
    "brightness": "float32",       # K; MODIS band 21/22, VIIRS I-4; null for Landsat
    "brightness_2": "float32",     # K; MODIS band 31, VIIRS I-5; null for Landsat
    "frp": "float32",              # fire radiative power, MW; null for Landsat
    "confidence": "Int8",          # 0 low, 1 nominal, 2 high
    "confidence_pct": "float32",   # MODIS only, 0-100
    "type": "Int8",                # archive only: 0 vegetation fire, 1 volcano, 2 static land source, 3 offshore
}

# A detection is identified by these. Exact repeats are duplicates.
DEDUPE_KEY = ["source", "satellite", "acq_datetime", "latitude", "longitude"]
