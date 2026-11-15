# Compiled training dataset

2026-11-15

The four downloaded sources (harmonized FIRMS, Open-Meteo history, Daymet, LANDFIRE topography) are joined into one table per 10 km cell-day and split into train, validation and test. This is step 7 of [training-bundle.md](training-bundle.md).

## Result

8,071 complete cell-days, split 60/20/20 by date, in `data/training/compiled` (gitignored).

| Subset | Rows | Fire / background | Dates | Cells |
|---|---|---|---|---|
| train | 4,845 | 2,425 / 2,420 | 2000-11-09 to 2022-03-06 | 4,587 |
| validation | 1,617 | 807 / 810 | 2022-03-07 to 2024-03-30 | 1,578 |
| test | 1,609 | 819 / 790 | 2024-03-31 to 2025-12-31 | 1,592 |

- **Rows are the cell-days that have Open-Meteo weather:** 9,000 so far, one day's free-tier budget out of the 200,000 queued. Only these can carry all four sources.
- **929 rows are excluded from the subsets:** 889 dated 2026 (the Daymet files end 2025-12-31) and 40 in water cells Daymet has no data for. They stay in `dataset.csv.gz` with the reason.
- **The table grows with each daily Open-Meteo run.** Rerun the command below with `--force` after a fetch.

## Files

| File | Contents |
|---|---|
| `train.csv.gz`, `validation.csv.gz`, `test.csv.gz` | The model-input subsets: 61 columns, no missing values in any input column |
| `dataset.csv.gz` | All 9,000 rows, with `split` (`train`, `validation`, `test`, `excluded`) and `excluded_reason` |
| `columns.json` | Role of every column: `id`, `target`, `label_detail`, `feature` or `meta` |
| `summary.json` | Row counts, split boundaries, exclusions |
| `_parts/` | Per-source feature tables, reused on the next run |

## Running it

From `apps/inference`:

```bash
python -m harmonization.compile_dataset ../../data
```

- `--force` rebuilds the per-source tables in `_parts/`. Needed after new Open-Meteo or Daymet downloads.
- `--ratios 0.6 0.2 0.2` and `--split-by time|random` change the split.
- `--landfire-pixel-m 240` picks the LANDFIRE pyramid level.
- The first run reads about 8,200 Daymet files and takes a few minutes; later runs take seconds.
- It needs only numpy and pandas (no GDAL, rasterio or pyarrow).

Code: `harmonization/compile_dataset.py`, `sources/topography/landfire.py`, tests in `tests/test_compile.py`.

## Columns

54 of the 61 columns are model inputs (`feature` in `columns.json`).

| Group | Columns | Source and meaning |
|---|---|---|
| IDs | `date`, `cell_row`, `cell_col`, `cell_id` | Local solar date and the 10 km cell |
| Target | `fire` | 1 = a vegetation-fire detection from any sensor that day; 0 = sampled background (no detection of any kind) |
| Label detail | `label_n_detections`, `label_frp_max` | Same-day FIRMS detail. **Not inputs: they leak the target.** `label_frp_max` is empty for background rows and Landsat-only fires |
| Place and season | `latitude`, `longitude`, `year`, `doy_sin`, `doy_cos` | Cell centre and day of year |
| FIRMS history (8) | `firms_fire_days_prev{1,7,30,365}d`, `firms_days_since_fire`, `firms_neighbour_fire_days_prev{1,7}d`, `firms_sensors_active` | Fire days in the cell and its 8 neighbours strictly before the date. `firms_days_since_fire` is capped at 3,650 (also used for "never"). `firms_sensors_active` counts the sensors whose archive covers the date |
| Open-Meteo (21) | `om_temp_*`, `om_rh_*`, `om_vpd_*`, `om_precip_sum`, `om_wind_*`, `om_gust_max`, `om_wind_from_sin/cos`, `om_soil_moisture_mean`, the `*_prev6d` versions, `om_elevation` | That day's weather from the 24 hourly values, and the 6 days before it. Units: deg C, %, kPa, mm, m/s, m3/m3 |
| Daymet (12) | `dm_prcp`, `dm_tmax`, `dm_tmin`, `dm_vpd`, `dm_prcp_sum_prev{7,30,90}d`, `dm_tmax_mean_prev{7,30}d`, `dm_vpd_mean_prev{7,30}d`, `dm_dry_days` | That day's values and antecedent conditions. VPD is derived from tmax, tmin and vapour pressure. `dm_dry_days` counts days since 1 mm or more of rain, capped at 90 |
| LANDFIRE (8) | `topo_elev_mean`, `topo_elev_std`, `topo_slope_mean`, `topo_slope_p90`, `topo_northness`, `topo_eastness`, `topo_flat_frac`, `topo_valid_frac` | LF 2020 elevation (m), slope (degrees) and aspect over the cell. Northness and eastness are the mean cos and sin of aspect with flat pixels counted as 0 |

## Choices made

- **Split is by date, not random.** Rows are ordered by date and cut at 60% and 80%, so validation is later than train and test later than validation, and no date is in two subsets. A random split would leak between nearby cell-days and overstate accuracy. This replaces the year-based default in `training_sample.py` (train to 2024, validation 2025, test 2026), whose `split` column is not carried over.
- **Only complete rows go into the subsets.** Keeping the 2026 rows would put Daymet gaps in the test set only, which the model would never have seen in training.
- **History features look strictly before the date,** so nothing from the day being predicted is an input. Same-day weather is an input, as it would come from a forecast at serving time.
- **LANDFIRE is read at 240 m, not 30 m.** The full-resolution GeoTIFFs are LZW-compressed and no GDAL is installed; the `.tif.ovr` pyramids are deflate-compressed and readable with the standard library. Each 10 km cell is summarised from about 1,700 nearest-neighbour-sampled pixels of its 111,000.
- **Daymet has no 31 December in leap years** (365-day years); that date uses 30 December.

## Checks run

- No duplicate cell-days; `fire` equals "at least one detection that day" for all 9,000 rows.
- No missing values in any input column of the three subsets.
- LANDFIRE cell-mean elevation and Open-Meteo elevation correlate at 0.996 (median difference 10 m), which confirms the raster reader and the cell placement.
- Daymet and Open-Meteo agree on the same cell-days: daily maximum temperature 0.989, minimum 0.974, vapour pressure deficit 0.89.
- Fire rows differ from background rows in the expected direction: 0.78 against 0.05 fire days in the previous week, lower minimum humidity (38% against 44%), less rain that day (0.6 mm against 2.3 mm).
- 9 unit tests pass when run directly. `pytest` itself has not been run: it is not installed in the workspace that ran them.

## Limits

- **Small:** 8,071 rows from 200,000 queued. Each daily Open-Meteo run adds about 9,000.
- **`fire` is a FIRMS detection, not a confirmed wildfire.** NIFC / WFIGS labels (decision 8) are still not in the table.
- **Background is "no sensor reported anything",** not confirmed absence, and overpass gaps are not modelled.
- **`year` and `firms_sensors_active` shift between subsets.** With a date split, validation and test hold values the model never saw in training. Consider dropping them as inputs.
- **Fire-history counts depend on the sensor era:** more sensors after 2012 means more fire days found.
- **Features differ from the live bundle.** Live weather is NOAA RRFS, live terrain is USGS 3DEP on a 1 km grid, and live fuels (LANDFIRE FBFM40, canopy) are not in this table at all.
- **Topography is LF 2020** for every year from 2000 to 2025.
- **No 2026 rows** until Daymet publishes 2026.
