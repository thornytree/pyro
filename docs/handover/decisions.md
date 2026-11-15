> Current prototype integration: Express currently uses request-driven, concurrent
> retrieval over a centered 300-square-mile region and returns `observed` source
> data. The fixed 50 km grid and scheduler described below are retained as a
> separate optional path; they are not started by the HTTP server. See
> `apps/orchestrator/README.md` for the running API and required credentials.

# Decisions

## 2026-11-14

| # | Decision | Detail |
|---|---|---|
| 1 | Daymet is training only | Not part of the real-time bundle. See the risk note in `data-sources.md`. |
| 2 | Ingestion is scheduled, scoped by region | Not fetched per user click. Users pick a region on the map (or share a region ID); only requested regions get the expensive processing. |
| 3 | First model target is burn probability | Direction, rate of spread and perimeter are shown as a proof of concept only where perimeter data exists. |
| 4 | Work is split into work-item folders under `apps/` | See `apps/README.md`. |
| 5 | Three apps: `web` and `orchestrator` in TypeScript, `inference` in Python | The model is exposed to the orchestrator through a FastAPI service. |
| 6 | Fixed 50 km x 50 km tiles | Selections snap to a tile; the tile ID is the shareable location ID. Model cell size inside a tile, projection and time step are still open. |
| 7 | Coverage is all of CONUS | Any CONUS tile can be requested. FIRMS is polled nationwide; weather and the model still run per active tile only (decision 2). |
| 8 | Label source is NIFC / WFIGS | Incident locations and perimeters as confirmed-fire labels. Endpoints, fields, history depth and licence are not yet verified. |
| 9 | Model is a latent fire state with per-sensor likelihoods | As in `model-outline.md`. The plain-features alternative is rejected. Requires per-sensor overpass coverage. |
| 10 | Map library is MapLibre GL JS | Open source, no API token. Basemap style URL is configuration (`VITE_MAP_STYLE_URL`). Chosen while building the first cut of `apps/web`; not yet reviewed by the team. |
| 11 | Live fetchers follow decision 2 | The orchestrator polls FIRMS nationwide on a schedule and fetches weather only for active tiles; a user request only activates a tile and reads the cache. Replaces the per-click fetch on a 300 square mile box. See `apps/orchestrator/src/fan-out/README.md`. |
| 12 | Landsat is included in the live FIRMS poll | It adds detections the other sensors miss (see "Landsat assessment" below) for one extra request per poll. Its weight is left to the model's per-sensor likelihood. |

## Proposed, not agreed (2026-11-14)

- **Web / orchestrator contract.** `GET /tiles?lat=&long=` returning tile ID, status (`ready` or `queued`), bounds, and GeoJSON cells and detections in EPSG:4326. Written from the web side only; see `apps/web/README.md`.
- **Showing detection age and uncertainty.** Detections fade over 24 hours; cells get fainter as uncertainty rises.
- **Statewide preview contract.** `GET /states/{fips}/preview` returning one value per 50 km tile in a state. Web side only, and it conflicts with decision 2 as written (inactive tiles have no model output); see `apps/web/README.md`.
- **Tile grid projection and IDs.** 50 km tiles in EPSG:5070, a 95 x 59 grid, IDs like `r40c80`. Implemented as a working choice in `apps/inference/shared/grid.py` during the FIRMS harmonization; the team has not agreed it, and the web mock does not use it yet.
- **Harmonized FIRMS schema.** One schema for all five sensors, with a 0/1/2 confidence class (MODIS keeps its 0 to 100 value separately) and non-fire detections kept but flagged. See `firms-harmonization.md`.
- **Historical routes.** `GET /history/tiles?lat=&long=&date=` and `GET /history/states/{fips}/preview?date=`, same shapes as live, read-only so a replay never activates a tile. Web side only; see `apps/web/README.md`.
- **Spread in the live tile.** Optional `spread` (outlines at 6, 12 and 24 h around cells at 80% or more, with heading, rate and reach) and `drivers` (the weather used). Goes beyond decision 3, which limits spread to a proof of concept where perimeters exist; on the web it is labelled experimental and runs on a mock formula. See `apps/web/README.md`.
- **Terrain under the tile view.** Elevation tint, hillshade and contours from a configurable DEM source (`VITE_TERRAIN_*`); map rotation and pitch disabled so north stays up. Built in `apps/web`, not reviewed by the team.

## Design for decision 2

Tile size and CONUS coverage are agreed (decisions 6 and 7). Polling cadence, weather sampling and the tile lifecycle below are still recommendations.

- **Fixed tiles, not free circles.** Divide CONUS into a fixed grid of 50 km x 50 km tiles (about 31 miles a side, roughly 965 square miles, about 3,200 tiles in total). A user's selection or shared location snaps to the tile containing it. The tile ID is the shareable "location ID". Fixed tiles mean two users looking at the same area share one cached result.
- **FIRMS runs nationwide on a schedule.** The Area API takes a bounding box, so all of CONUS is one request per sensor, about five requests per poll against a limit of 5,000 per 10 minutes. This gives the national detection layer cheaply. Implemented (decision 11): every 15 minutes, last 2 days.
- **Weather and the model run per active tile.** Weather is the expensive source because it is fetched per point. Sample it on a coarse grid inside the tile (about every 10 km, 25 to 36 points) and interpolate.
- **Active tile lifecycle.** A tile becomes active when a user requests it, is refreshed hourly while active, and expires after a period with no views (suggest 24 hours).
- **Terrain and fuels** are cached per tile on first request and never refetched.

## Landsat assessment (decision 12)

Checked on the harmonized archive, 2023 to 2025, CONUS tiles only. Whether Landsat raises model confidence cannot be measured until the model is trained against WFIGS labels; this measures how much independent evidence it adds.

- About 83% of Landsat 1 km cell-days had no MODIS or VIIRS vegetation-fire detection within 1 km and one day.
- Landsat was the only sensor to see fire in about 23% of tile-days with any fire (about 42,000 a year). In about 70% of those, no other sensor saw fire in that tile the day before or after either.
- 73% of those Landsat-only detections are high confidence. About 10% sit in 1 km cells that fire on 10 or more dates a year, so are likely gas flares or industrial heat.
- Limits: daytime only, about an 8-day revisit with Landsat 8 and 9, no FRP, and no `type` flag to filter static sources. Many Landsat-only detections are probably small agricultural or prescribed burns below the VIIRS threshold, not wildfires. The per-sensor false-alarm rate learned from WFIGS labels has to absorb that.
- Cost: one more request per nationwide poll (five instead of four), about two transactions against 5,000 per 10 minutes.

## Proof of concept for decision 3

Two modes, labelled differently in the UI:

1. **Historical replay.** For fires in the Mendeley daily perimeter dataset (western US, 2020 to 2024, 737 fires), show actual day-by-day perimeters, and direction and rate of spread derived from them. This is where a spread model can be compared with what happened.
2. **Live observed movement.** For current fires, direction and rate can be estimated from how FIRMS detections shift between satellite passes. This is an observation of past movement, not a forecast, and it is coarse (375 m pixels, a few passes a day).

Live perimeters can come from NIFC / WFIGS (decision 8) once its perimeter feed is verified.
