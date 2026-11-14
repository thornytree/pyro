# fan-out (trigger and scheduled ingestion)

Work item 1: user trigger inputs, plus the live fetchers. Part of the TypeScript orchestrator.

Follows decision 2 in `../../../../docs/handover/decisions.md`: ingestion is scheduled, and a user request never fetches external data itself.

## How it works

- **Grid** (`grid.ts`): the 50 km CONUS tiles in EPSG:5070, IDs like `r24c07`. A port of `apps/inference/shared/grid.py`; the two must stay identical.
- **FIRMS** (`firms.ts`): every 15 minutes, one request per sensor for the whole tile frame (MODIS, VIIRS S-NPP, NOAA-20, NOAA-21 and Landsat), last 2 days. About 10 transactions per poll against 5,000 per 10 minutes. Each poll replaces the previous snapshot, which also drops real-time detections FIRMS has since superseded. Detections are tagged with their tile; those outside the frame are dropped.
- **Weather** (`meteo.ts`): for active tiles only, current Open-Meteo weather at 25 points (10 km spacing) inside the tile, in one request. Fetched when a tile is activated, then hourly.
- **Tile lifecycle** (`scheduler.ts`): a tile becomes active on request and expires after 24 hours without a view. At most 200 tiles are active; the least recently viewed is evicted beyond that.
- **Trigger** (`fan-out-entry.ts`): `requestTileAt(ingestion, lat, long)` snaps the point to its tile, marks it active and returns the cached bundle, with status `queued` until both FIRMS and weather are in.

`src/index.ts` starts the scheduler when `FIRMS_MAP_KEY` is set. Everything is in memory, so a restart starts cold.

## What `apps/web` expects

The web app calls `GET /tiles?lat=<number>&long=<number>` and `GET /states/{fips}/preview` (see `apps/web/README.md`). Both are proposals from the web side, not agreed interfaces, and no route is wired to the scheduler yet. Change them on both sides together.

## Open questions

- Agree or amend the `GET /tiles` and `GET /states/{fips}/preview` contracts, including the error body and status code for a point outside CONUS.
- What the state preview shows for tiles that are not active and so have no weather or model output.
- The web mock uses its own tile IDs (`mock-<row>_<col>`); switch it to the `r..c..` IDs when the contract is agreed.
- Polling cadence (15 min FIRMS, hourly weather) and the 200-tile cap are recommendations, not decisions.
