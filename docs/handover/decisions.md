# Decisions

## 2026-11-14

| # | Decision | Detail |
|---|---|---|
| 1 | Daymet is training only | Not part of the real-time bundle. See the risk note in `data-sources.md`. |
| 2 | Ingestion is scheduled, scoped by region | Not fetched per user click. Users pick a region on the map (or share a region ID); only requested regions get the expensive processing. |
| 3 | First model target is burn probability | Direction, rate of spread and perimeter are shown as a proof of concept only where perimeter data exists. |
| 4 | Backend is split into work-item folders | See `backend/README.md`. |

## Recommended design for decision 2 (not yet agreed)

- **Fixed tiles, not free circles.** Divide CONUS into a fixed grid of 50 km x 50 km tiles (about 31 miles a side, roughly 965 square miles, about 3,200 tiles in total). A user's selection or shared location snaps to the tile containing it. The tile ID is the shareable "location ID". Fixed tiles mean two users looking at the same area share one cached result.
- **FIRMS runs nationwide on a schedule.** The Area API takes a bounding box, so all of CONUS is one request per sensor, about five requests per poll against a limit of 5,000 per 10 minutes. This gives the national detection layer cheaply.
- **Weather and the model run per active tile.** Weather is the expensive source because it is fetched per point. Sample it on a coarse grid inside the tile (about every 10 km, 25 to 36 points) and interpolate.
- **Active tile lifecycle.** A tile becomes active when a user requests it, is refreshed hourly while active, and expires after a period with no views (suggest 24 hours).
- **Terrain and fuels** are cached per tile on first request and never refetched.

## Proof of concept for decision 3

Two modes, labelled differently in the UI:

1. **Historical replay.** For fires in the Mendeley daily perimeter dataset (western US, 2020 to 2024, 737 fires), show actual day-by-day perimeters, and direction and rate of spread derived from them. This is where a spread model can be compared with what happened.
2. **Live observed movement.** For current fires, direction and rate can be estimated from how FIRMS detections shift between satellite passes. This is an observation of past movement, not a forecast, and it is coarse (375 m pixels, a few passes a day).

Live perimeters would need NIFC / WFIGS data, which has not been evaluated.
