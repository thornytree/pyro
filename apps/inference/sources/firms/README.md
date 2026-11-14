# sources/firms

Work item 2: NASA FIRMS active fire detections (MODIS and VIIRS). This is the project's required NASA source.

- **Input:** bounding box, day range (max 5 per request), optional date.
- **Output:** detections normalized to the unified schema in `shared/`.
- **Auth:** `FIRMS_MAP_KEY` environment variable. Never commit it.
- **API:** `https://firms.modaps.eosdis.nasa.gov/api/area/csv/[MAP_KEY]/[SOURCE]/[west,south,east,north]/[DAY_RANGE]/[DATE]`

## Planned unified schema

| Field | MODIS column | VIIRS column | Note |
|---|---|---|---|
| latitude, longitude | same | same | pixel center |
| scan, track | same | same | pixel size in km |
| acq_date, acq_time | same | same | UTC |
| daynight | same | same | |
| brightness | `brightness` | `bright_ti4` | Kelvin; different channels, not directly comparable |
| brightness_2 | `bright_t31` | `bright_ti5` | Kelvin |
| frp | same | same | MW |
| confidence | 0-100 number (expected) | low / nominal / high (expected) | must be mapped to one scale |
| satellite, version | same | same | |

Column names and confidence formats are from memory. Confirm with one test call per source before coding the normalizer.

## Notes

- Keep a `source` field (MODIS, VIIRS_SNPP, VIIRS_NOAA20, VIIRS_NOAA21) so the model can weight sensors separately.
- NRT feeds contain real-time detections that are later replaced. Dedupe on ingest.
