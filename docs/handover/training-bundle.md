# Training bundle

2026-11-14

Combines the harmonized FIRMS archive with weather, topography and Daymet into one table for training and testing. Built in steps so each can be rerun alone.

## Status

| # | Step | State |
|---|---|---|
| 1 | 10 km daily grid (`shared/grid.py`) | Done |
| 2 | FIRMS per cell, day and sensor (`harmonization/firms_cells.py`) | Done: `data/training/firms_cell_day` |
| 3 | Training sample and cell list (`harmonization/training_sample.py`) | Done: `data/training/sample`, `cells.csv.gz` |
| 4 | Topography (LANDFIRE) for the cells in `cells.csv.gz` | Downloaded (LF 2020 elevation, slope, aspect in `data/landfire_us`); not yet resampled to cells |
| 5 | Daymet, first 25,000 cells in fetch order (`sources/daymet/fetch.py` -> `data/daymet_us`) | Running against the live API from `apps/inference/fetch_weather.cmd` on the Windows computer (about 2 cells/s with 4 requests at a time). The cell cap, 8 requests at a time and the water-cell skip are tested against a mock server only |
| 6 | Open-Meteo history for a random subsample (`harmonization/weather_queue.py`, `sources/weather/fetch_history.py` -> `data/open-meteo_us`) | Queue of 200,000 cell-days written; fetcher tested against a mock server only; one live request made by hand in a browser returned all 8 hourly variables. About 9,000 cell-days per daily run on the free tier |
| 7 | Join into one table, coverage report | Waits on 4 to 6 |

## Choices made

- **Cells are 10 km, 5 x 5 per tile, time step is one day.** Matches the 25 weather points per tile the orchestrator samples. IDs like `r40c80_32`; tables store the global `cell_row`, `cell_col`.
- **A day is the local solar date** (UTC shifted by longitude / 15 h), so it lines up with Daymet and local-time daily weather.
- **Fire counts are vegetation fires only.** Volcano, static-source and offshore detections are in `n_nonfire_*`. Landsat has no such flag.
- **Sample:** all 3,650,576 cell-days with a vegetation-fire detection, plus as many with no detection of any kind, drawn at random from the same 70,665 cells and the same year (7.3 M rows). Background rows mean "no sensor reported anything", not confirmed absence of fire.
- **Sensor columns are empty outside that sensor's archive dates**, so a missing sensor is not read as "saw nothing". Overpass gaps inside the archive period are still not modelled.
- **Split is by time:** train to 2024, validation 2025, test 2026. A working default (`--validation-year`, `--test-year`); earlier cut-offs would leave no NOAA-21 or Landsat data in training.

## Not yet in the table

- Labels. FIRMS columns are observations; NIFC / WFIGS (decision 8) is still unverified and not downloaded.
- Any weather, terrain or fuel feature (step 7 joins them).

## Weather choices

- **Daymet:** `tmax, tmin, prcp, vp` from 2000 to Daymet's latest year, one Single Pixel request per cell, raw response kept per cell.
- **Daymet is capped at 25,000 of the 70,665 cells** (`PYRO_DAYMET_CELLS` in `fetch_weather.cmd`), because all cells took about 9 hours. Fetch order is the Open-Meteo queue's, which is random and weighted by sampled days, so the cap keeps about 3.3 M of the 7.3 M sample rows: 56% of fire rows and 35% of background rows. Rows in the other cells have no Daymet values. Raising the cap continues from what is on disk.
- **Cells whose centre is water are dropped.** Daymet answers HTTP 400 there; the cell goes into `data/daymet_us/no_data.csv` and is not requested again.
- **Gridded Daymet files were ruled out:** about 100 variable-year files of several GB each, behind an Earthdata login.
- **Open-Meteo:** the free tier (under 10,000 calls a day) cannot cover the sample, so a fixed random subset is fetched in a fixed random order. Each cell-day gets the 7 local days ending on it, hourly, 8 variables; daily values are derived at join time.
- Daymet has nothing for the current year, so test-year rows will have no Daymet values.

## Checks run

- Detections in step 2 equal the harmonized rows inside the CONUS frame for every sensor (19,491,344 in total).
- Sample has no duplicate cell-days; every fire row has a detection and no background row does; one cell-day recomputed from the harmonized file matches.
- Projection inverse (`from_albers`) round-trips to under a millimetre.

## Running the downloads

- Run `apps/inference/fetch_weather.cmd` on the Windows computer (once a day while the Open-Meteo queue lasts). It checks the connection, then starts both fetchers; both resume.
- The downloads cannot run from Claude's workspaces: their network does not reach `daymet.ornl.gov` or `archive-api.open-meteo.com`.
- `CERTIFICATE_VERIFY_FAILED` on the Windows computer is handled in `shared/net.py` (system trust store through `truststore`, or `PYRO_CA_BUNDLE`). `python -m shared.net` reports who signed the certificate the network presents.
