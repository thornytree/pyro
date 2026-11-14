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

## Proposed, not agreed (2026-11-14)

- **Web / orchestrator contract.** `GET /tiles?lat=&long=` returning tile ID, status (`ready` or `queued`), bounds, and GeoJSON cells and detections in EPSG:4326. Written from the web side only; see `apps/web/README.md`.
- **Showing detection age and uncertainty.** Detections fade over 24 hours; cells get fainter as uncertainty rises.

## Design for decision 2

Tile size and CONUS coverage are agreed (decisions 6 and 7). Polling cadence, weather sampling and the tile lifecycle below are still recommendations.

- **Fixed tiles, not free circles.** Divide CONUS into a fixed grid of 50 km x 50 km tiles (about 31 miles a side, roughly 965 square miles, about 3,200 tiles in total). A user's selection or shared location snaps to the tile containing it. The tile ID is the shareable "location ID". Fixed tiles mean two users looking at the same area share one cached result.
- **FIRMS runs nationwide on a schedule.** The Area API takes a bounding box, so all of CONUS is one request per sensor, about five requests per poll against a limit of 5,000 per 10 minutes. This gives the national detection layer cheaply.
- **Weather and the model run per active tile.** Weather is the expensive source because it is fetched per point. Sample it on a coarse grid inside the tile (about every 10 km, 25 to 36 points) and interpolate.
- **Active tile lifecycle.** A tile becomes active when a user requests it, is refreshed hourly while active, and expires after a period with no views (suggest 24 hours).
- **Terrain and fuels** are cached per tile on first request and never refetched.

## Proof of concept for decision 3

Two modes, labelled differently in the UI:

1. **Historical replay.** For fires in the Mendeley daily perimeter dataset (western US, 2020 to 2024, 737 fires), show actual day-by-day perimeters, and direction and rate of spread derived from them. This is where a spread model can be compared with what happened.
2. **Live observed movement.** For current fires, direction and rate can be estimated from how FIRMS detections shift between satellite passes. This is an observation of past movement, not a forecast, and it is coarse (375 m pixels, a few passes a day).

Live perimeters can come from NIFC / WFIGS (decision 8) once its perimeter feed is verified.
