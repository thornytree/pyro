# Data sources

Decision date: 2026-11-14. Facts below were read from each provider's page on that date unless marked unverified.

## Summary

| Source | Role | Decision |
|---|---|---|
| NASA FIRMS Area API | Live fire detections | Core (meets the NASA requirement) |
| NASA FIRMS Archive | Historical detections for training | Core |
| Open-Meteo | Weather covariates, live and historical | Core |
| LANDFIRE | Static fuels, vegetation, terrain | Core |
| Mendeley daily fire perimeters | Validation for the spread model | Later |
| NCEI CDO v2 | Station weather | Dropped |
| Daymet | Historical gridded weather | Dropped |
| USGS National Map | Elevation | Dropped (redundant) |

## Core

### NASA FIRMS Area API

- URL: https://firms.modaps.eosdis.nasa.gov/api/area/
- Request: `/api/area/csv/[MAP_KEY]/[SOURCE]/[west,south,east,north]/[DAY_RANGE]/[DATE]` (date optional, YYYY-MM-DD)
- Sources: `MODIS_NRT`, `VIIRS_SNPP_NRT`, `VIIRS_NOAA20_NRT`, `VIIRS_NOAA21_NRT`, `LANDSAT_NRT` (US/Canada only), plus `_SP` (science quality) variants for MODIS and VIIRS
- Limits: max 5 days per request; 5,000 transactions per 10 minutes; bigger requests can count as several transactions
- Auth: free MAP_KEY, read from an environment variable
- NRT feeds include real-time and ultra-real-time detections, which are removed once the matching NRT record is processed or after 6 hours. Expect detections to appear and then be replaced; dedupe on ingest.
- `/api/data_availability/` reports which dates each source has
- Why core: several independent sensors observing the same ground is exactly what the model arbitrates between
- Unverified: returned column names. The page links to per-sensor attribute tables that were not read. Expected from memory: latitude, longitude, acquisition date/time, confidence, FRP, brightness temperature. Confirm with a test call.

### NASA FIRMS Archive

- URL: https://firms.modaps.eosdis.nasa.gov/download/
- Covers data older than 7 days. Start dates: MODIS C6.1 2000-11-01, VIIRS S-NPP 2012-01-20, VIIRS NOAA-20 2018-04-01, VIIRS NOAA-21 2024-01-17, Landsat 30 m 2022-06-20
- Formats: shapefile, CSV, JSON
- Access: submit a request (Earthdata Login or emailed one-time code), download link arrives by email. Turnaround is not stated.
- NRT data is replaced by science-quality data after about 5 months, so the archive and the live feed differ slightly for recent dates

### Open-Meteo

- URL: https://open-meteo.com/en/docs
- Variables we need: wind speed (10 m and higher) and 10 m gusts, 2 m relative humidity, vapour pressure deficit, soil moisture at several depths, precipitation, 2 m temperature
- US models: GFS and RRFS, hourly updates, 3 to 25 km, 16-day forecast. RRFS is the North America best match and supplies 15-minute data.
- HRRR is marked as discontinued on 2026-11-30. Request RRFS or best match, never HRRR by name.
- Historical Weather API and Historical Forecast API exist alongside the forecast API; `past_days` goes up to 92
- Why core: one provider for both training history and live inference keeps features consistent
- Unverified: free-tier call cap and exact non-commercial terms (on the pricing page, not read). Check before polling a dense CONUS grid.

### LANDFIRE

- URL: https://landfire.gov/data
- Layers: surface and canopy fuels, fuel vegetation, existing vegetation, disturbance, historic fire regime, and topography (elevation, slope, aspect)
- Current version: LF 2025; CONUS full-extent release dated 2026-10-27
- Access: full-extent downloads, LFPS REST API (lfps.usgs.gov), WCS/WMS, image service
- CONUS projection: EPSG:5070
- Use: download once, resample to our grid, cache. It is static between annual updates.
- Unverified: pixel size (expected 30 m from memory)

## Later

### Mendeley daily fire perimeter progression (2020 to 2024)

- URL: https://data.mendeley.com/datasets/95rj5d379g/2 (DOI 10.17632/95rj5d379g.2)
- 12,705 perimeter observations across 737 fires, hand-digitized from NIROPS aerial infrared; one shapefile, EPSG:4326, UTC timestamps
- Coverage: US Forest Service Regions 1 to 6 (western US only), June 2020 to late 2024
- License: CC BY 4.0, so it needs attribution on the site
- Use: ground truth for day-over-day spread once we build that feature. Not needed for the detection heat map.

## Dropped

### NCEI Climate Data Online v2

Station-based summaries (daily, monthly, yearly), not a grid. Token limited to 5 requests per second and 10,000 per day. Open-Meteo already gives gridded versions of the same variables.

### Daymet

1 km daily gridded weather with REST and THREDDS access, but released on an annual cycle (from memory, not confirmed on the page), so it cannot feed live inference and would make training features differ from serving features. It is hosted by NASA's ORNL DAAC, so it remains an option if a second NASA dataset helps with judging.

### USGS National Map

Useful part is 3DEP elevation. LANDFIRE ships elevation, slope and aspect already aligned with its fuel layers, so this adds work without adding information.

## Not in the original list but needed

A confirmed-wildfire label source. FIRMS reports thermal anomalies, which include gas flares, agricultural burns and industrial heat. Candidate: NIFC / WFIGS incident locations and perimeters. Not yet evaluated.
