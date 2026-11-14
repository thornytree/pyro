"""Turn raw FIRMS rows (any sensor, archive or API) into the unified schema."""
from __future__ import annotations

import numpy as np
import pandas as pd

from shared import firms_schema as schema
from shared import grid

# Read these as strings: confidence is a number for MODIS but a letter for
# VIIRS and Landsat, and version mixes "2" with "2.0NRT".
RAW_TEXT_COLUMNS = ["satellite", "instrument", "confidence", "version", "daynight"]

# The archive download names the VIIRS channels like MODIS (brightness,
# bright_t31). The Area API is documented to use bright_ti4 / bright_ti5.
_ALIASES = {"bright_ti4": "brightness", "bright_ti5": "bright_t31"}

# Raw `satellite` value -> (source, satellite). Names seen in the 2026-11-14
# archive download, plus the single-letter forms FIRMS uses in older files.
_SATELLITES = {
    "Terra": ("MODIS", "Terra"), "T": ("MODIS", "Terra"),
    "Aqua": ("MODIS", "Aqua"), "A": ("MODIS", "Aqua"),
    "SNPP": ("VIIRS_SNPP", "SNPP"), "N": ("VIIRS_SNPP", "SNPP"),
    "N20": ("VIIRS_NOAA20", "N20"),
    "N21": ("VIIRS_NOAA21", "N21"),
    "L8": ("LANDSAT", "L8"), "L9": ("LANDSAT", "L9"),
}

_LETTER_CONFIDENCE = {
    "l": schema.CONFIDENCE_LOW, "low": schema.CONFIDENCE_LOW,
    "n": schema.CONFIDENCE_NOMINAL, "nominal": schema.CONFIDENCE_NOMINAL,
    "m": schema.CONFIDENCE_NOMINAL, "medium": schema.CONFIDENCE_NOMINAL,
    "h": schema.CONFIDENCE_HIGH, "high": schema.CONFIDENCE_HIGH,
}


def _text(raw: pd.DataFrame, name: str, clean=str.strip) -> pd.Series:
    """A text column, cleaned once per distinct value. All-null if absent."""
    if name not in raw.columns:
        return pd.Series(np.nan, index=raw.index, dtype="object")
    values = raw[name].astype("category")
    return values.map(lambda v: clean(str(v)), na_action="ignore").astype("object")


def _number(raw: pd.DataFrame, name: str) -> pd.Series:
    if name not in raw.columns:
        return pd.Series(np.nan, index=raw.index, dtype="float32")
    return pd.to_numeric(raw[name], errors="coerce").astype("float32")


def _quality_of(version: str) -> str:
    """sp / nrt / rt / urt from the version suffix (6.03, 6.1NRT, 2.0URT)."""
    version = version.upper()
    for suffix, quality in (("NRT", "nrt"), ("URT", "urt"), ("RT", "rt")):
        if version.endswith(suffix):
            return quality
    return "sp"


def _acq_datetime(raw: pd.DataFrame) -> pd.Series:
    """acq_date (YYYY-MM-DD) + acq_time (HHMM, UTC) -> UTC timestamp."""
    date = pd.to_datetime(raw["acq_date"], format="%Y-%m-%d", errors="coerce")
    hhmm = pd.to_numeric(raw["acq_time"], errors="coerce")
    hours, minutes = hhmm // 100, hhmm % 100
    offset = pd.to_timedelta((hours * 60 + minutes).where((hours < 24) & (minutes < 60)), unit="m")
    return (date + offset).dt.tz_localize("UTC").astype(schema.COLUMNS["acq_datetime"])


def _confidence(text: pd.Series, is_modis: np.ndarray):
    """Returns (class 0-2 as Int8, MODIS percentage as float32)."""
    level = text.map(_LETTER_CONFIDENCE).to_numpy(dtype="float64", na_value=np.nan)

    pct = pd.to_numeric(text, errors="coerce").to_numpy(dtype="float64", na_value=np.nan)
    pct = np.where(is_modis, pct, np.nan)
    modis_level = np.select(
        [pct < schema.MODIS_NOMINAL_MIN, pct < schema.MODIS_HIGH_MIN, ~np.isnan(pct)],
        [schema.CONFIDENCE_LOW, schema.CONFIDENCE_NOMINAL, schema.CONFIDENCE_HIGH],
        default=np.nan,
    )
    level = np.where(np.isnan(level), modis_level, level)
    return (
        pd.Series(level, index=text.index).astype("Int8"),
        pd.Series(pct, index=text.index, dtype="float32"),
    )


def normalize(raw: pd.DataFrame, default_quality: str = "nrt") -> pd.DataFrame:
    """Raw FIRMS rows -> unified schema (shared/firms_schema.py).

    Read `raw` with `dtype` set to str for RAW_TEXT_COLUMNS.
    `default_quality` is used for rows with no `version` (Landsat, which is
    only published as NRT). Rows without a usable position or time are
    dropped; an unknown satellite name raises, so new sensors are not
    silently mislabelled. Does not dedupe; see `dedupe`.
    """
    raw = raw.rename(columns=_ALIASES)

    satellite_raw = _text(raw, "satellite")
    unknown = sorted(set(satellite_raw.dropna().unique()) - set(_SATELLITES))
    if unknown:
        raise ValueError(f"Unknown FIRMS satellite value(s): {unknown}")
    source = satellite_raw.map({k: v[0] for k, v in _SATELLITES.items()})
    satellite = satellite_raw.map({k: v[1] for k, v in _SATELLITES.items()})
    is_landsat = (source == "LANDSAT").to_numpy(dtype=bool)
    is_modis = (source == "MODIS").to_numpy(dtype=bool)

    latitude = pd.to_numeric(raw["latitude"], errors="coerce").astype("float64")
    longitude = pd.to_numeric(raw["longitude"], errors="coerce").astype("float64")

    x, y = grid.to_albers(latitude.to_numpy(), longitude.to_numpy())
    # Round first so the stored x/y always fall inside the stored tile.
    x, y = np.round(x, 1), np.round(y, 1)
    row, col = grid.tile_index(x, y)
    # Build IDs once per distinct tile, not once per detection.
    code = row.astype("int32") * grid.N_COLS + col
    tile = pd.Series(code, index=raw.index).map(
        {c: grid.tile_id(c // grid.N_COLS, c % grid.N_COLS) for c in np.unique(code[row >= 0])}
    )

    version = _text(raw, "version")
    confidence, confidence_pct = _confidence(
        _text(raw, "confidence", lambda v: v.strip().lower()), is_modis
    )
    type_code = pd.to_numeric(raw["type"], errors="coerce") if "type" in raw.columns else np.nan

    out = pd.DataFrame(
        {
            "source": source,
            "satellite": satellite,
            "quality": version.map(_quality_of, na_action="ignore").fillna(default_quality),
            "version": version,
            "acq_datetime": _acq_datetime(raw),
            "daynight": _text(raw, "daynight", lambda v: v.strip().upper()),
            "latitude": latitude,
            "longitude": longitude,
            "x": x,
            "y": y,
            "tile_id": tile,
            "scan": _number(raw, "scan").mask(is_landsat, schema.LANDSAT_PIXEL_KM),
            "track": _number(raw, "track").mask(is_landsat, schema.LANDSAT_PIXEL_KM),
            "brightness": _number(raw, "brightness"),
            "brightness_2": _number(raw, "bright_t31"),
            "frp": _number(raw, "frp"),
            "confidence": confidence,
            "confidence_pct": confidence_pct,
            "type": pd.Series(type_code, index=raw.index).astype("Int8"),
        }
    )
    usable = (
        out["latitude"].between(-90, 90)
        & out["longitude"].between(-180, 180)
        & out["acq_datetime"].notna()
        & out["source"].notna()
    )
    out = out[usable].reset_index(drop=True)
    return with_dtypes(out)


def with_dtypes(frame: pd.DataFrame) -> pd.DataFrame:
    """Apply the schema's column order and dtypes."""
    frame = frame[list(schema.COLUMNS)]
    return frame.astype(
        {c: t for c, t in schema.COLUMNS.items() if t != "category"}
    ).astype({c: "category" for c, t in schema.COLUMNS.items() if t == "category"})


def dedupe(frame: pd.DataFrame) -> pd.DataFrame:
    """Drop repeats of the same detection, keeping the best version of it.

    A repeat is the same sensor, time and pixel centre. That covers an NRT or
    real-time detection whose science-quality replacement is also present,
    and Landsat pixels reported twice where adjacent scenes overlap. The best
    quality level wins, then the higher confidence. Other sensors seeing the
    same fire are kept. Returns rows sorted by time.
    """
    rank = frame["quality"].astype("object").map(
        {q: i for i, q in enumerate(schema.QUALITIES)}
    )
    frame = (
        frame.assign(_rank=rank.to_numpy())
        .sort_values(
            ["acq_datetime", "_rank", "confidence"],
            ascending=[True, True, False], na_position="last", kind="stable",
        )
        .drop_duplicates(subset=schema.DEDUPE_KEY, keep="first")
        .drop(columns="_rank")
    )
    return frame.reset_index(drop=True)
