# sources/firms

Work item 2: NASA FIRMS active fire detections (MODIS, VIIRS and Landsat). This is the project's required NASA source.

This folder is the **archive** side: normalizing and loading historical detections for training. **Live** detections are fetched by the orchestrator (`apps/orchestrator/src/fan-out/firms.ts`): the four MODIS/VIIRS feeds for the requested region, plus an optional nationwide poll with Landsat that is not started.

- **Input:** bounding box, day range (max 5 per request), optional date.
- **Output:** detections normalized to the unified schema in `shared/`.
- **Auth:** `FIRMS_MAP_KEY` environment variable. Never commit it.
- **API:** `https://firms.modaps.eosdis.nasa.gov/api/area/csv/[MAP_KEY]/[SOURCE]/[west,south,east,north]/[DAY_RANGE]/[DATE]`

## Unified schema

Defined in `shared/firms_schema.py`; `normalize.py` produces it. One row is one detection from one sensor.

| Field | Meaning | Null for |
|---|---|---|
| source | MODIS, VIIRS_SNPP, VIIRS_NOAA20, VIIRS_NOAA21, LANDSAT | |
| satellite | Terra, Aqua, SNPP, N20, N21, L8, L9 | |
| quality | `sp` (science quality archive), `nrt`, `rt`, `urt`, from the `version` suffix | |
| version | as delivered: `6.03`, `61.03`, `6.1NRT`, `2`, `2.0NRT` | Landsat |
| acq_datetime | UTC, from `acq_date` + `acq_time` | |
| daynight | D or N | |
| latitude, longitude | pixel centre, WGS84 | |
| x, y | EPSG:5070 metres (`shared/grid.py`) | |
| tile_id | 50 km tile, e.g. `r40c80` | Alaska, Hawaii (outside the CONUS frame) |
| scan, track | pixel size in km; fixed 0.03 for Landsat | |
| brightness | Kelvin; MODIS band 21/22, VIIRS I-4. Not comparable across sensors | Landsat |
| brightness_2 | Kelvin; MODIS band 31, VIIRS I-5 | Landsat |
| frp | MW | Landsat |
| confidence | 0 low, 1 nominal, 2 high | |
| confidence_pct | MODIS's 0-100 value | VIIRS, Landsat |
| type | 0 vegetation fire, 1 volcano, 2 other static land source, 3 offshore | NRT rows, Landsat |

## What the raw files contain

Verified against the archive download of 2026-11-14 (`data/firms_historical_us`). The Area API has not been called yet; `normalize.py` also accepts the `bright_ti4` / `bright_ti5` names its documentation uses.

- MODIS and VIIRS share one header: `latitude, longitude, brightness, scan, track, acq_date, acq_time, satellite, instrument, confidence, version, bright_t31, frp, daynight`. The archive files add `type`; the NRT files do not have it. VIIRS uses `brightness` / `bright_t31` here, not `bright_ti4` / `bright_ti5`.
- Landsat has only `latitude, longitude, scan, track, acq_date, acq_time, satellite, instrument, confidence, daynight`. Its `scan` / `track` are pixel positions in the scene, not pixel sizes.
- Confidence: MODIS 0-100 (classed as low < 30 <= nominal < 80 <= high, FIRMS's own classes), VIIRS `l` / `n` / `h`, Landsat `L` / `M` / `H`.
- `satellite` is `Terra`, `Aqua`, `SNPP`, `N20`, `N21`, `L8`, `L9`.
- Landsat reports a pixel twice where adjacent scenes overlap (about 9% of rows). `dedupe` keeps one.

## Harmonizing an archive download

From `apps/inference`:

```
python -m sources.firms.archive ../../data/firms_historical_us ../../data/firms_harmonized
```

Writes `<SOURCE>/<year>.parquet` (or `.csv.gz` without pyarrow) and `_summary.json`. Load it with `sources.firms.archive.read_harmonized(path, sources=[...], years=[...])`. Tests: `python -m pytest tests`.

## Notes

- Detections of one fire by different sensors stay as separate rows, with `source` set, so the model can weight sensors separately. Only repeats within a sensor are removed.
- Archive rows with `type` 1 to 3 are not vegetation fires. They are kept and flagged, not dropped.
- NRT feeds contain real-time detections that are later replaced. Dedupe on ingest.
