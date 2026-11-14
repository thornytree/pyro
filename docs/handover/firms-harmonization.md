# FIRMS data harmonization

2026-11-14

## Result

The FIRMS data is harmonized: 21,000,716 detections from all five sensors, in one schema, are in `data/firms_harmonized`. Every sensor's output was cross-checked against its raw files and all values match.

| Sensor | Rows | Covers |
| --- | --- | --- |
| MODIS (Terra, Aqua) | 3,171,984 | Nov 2000 to 14 Nov 2026 |
| VIIRS S-NPP | 7,615,736 | Jan 2012 to 2 Nov 2026 |
| VIIRS NOAA-20 | 4,713,097 | Apr 2018 to 14 Nov 2026 |
| VIIRS NOAA-21 | 1,811,506 | Mar 2023 to 14 Nov 2026 |
| Landsat 8/9 | 3,688,393 | Jun 2022 to 14 Nov 2026 |

- **Layout:** one file per sensor per year (`<SOURCE>/<year>.csv.gz`), plus `_summary.json` with the counts.
- **Loading:** `read_harmonized(path, sources=[...], years=[...])` in `sources/firms/archive.py` returns it with the right types.
- **Code:** the normalizer and loader are in `apps/inference/sources/firms/`, the schema and tile grid in `apps/inference/shared/`, and tests in `apps/inference/tests/`. The code is in commit `4fc22ca`; the harmonized data is gitignored.

## What the files actually contained

The raw files differed from what the README expected in six ways.

- **VIIRS column names:** the archive uses `brightness` and `bright_t31`, not `bright_ti4`/`bright_ti5` as the README expected. The code accepts both.
- **Landsat:** it has no brightness, FRP or version, so those are empty. Its scan/track are pixel positions, not sizes, so they are set to the 30 m pixel.
- **Landsat duplicates:** about 9% of rows (354,967) were the same pixel reported twice where scenes overlap. Those were removed, plus 3 in S-NPP; no other sensor had any.
- **Confidence:** every sensor now has a 0/1/2 class (low, nominal, high). MODIS keeps its 0–100 value in a separate column.
- **Non-fire detections:** the archive rows have a `type` flag, and roughly 12% are volcanoes, static sources such as gas flares, or offshore. They are kept and flagged; the model can filter on it.
- **S-NPP gap:** its data stops on 2 November, while the other sensors run to 14 November.

## Things to know

The tile projection is a working choice, and the output is gzipped CSV until pyarrow is installed.

- **Projection is a working choice:** tiles are 50 km in EPSG:5070 (95 × 59 grid, IDs like `r40c80`). The team had not decided this; it lives in `shared/grid.py` if something else is picked.
- **Alaska and Hawaii:** about 1.5 million detections there are kept but have no tile, since the grid is CONUS only.
- **Format is gzipped CSV, not Parquet:** pyarrow could not be installed in the environment the run used. It is now in `pyproject.toml`, so after `uv sync` the command in `sources/firms/README.md` rewrites everything as Parquet.
- **Tests:** they pass in Claude's cloud workspace but have not been run on the Windows computer, where pytest is not installed yet.
- **Docs touched:** the two READMEs, `pyproject.toml`, and one line in the handover risks doc, which now says the archive columns are verified and the API ones are not.
