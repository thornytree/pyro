# harmonization

Work item 2: builds the harmonized data bundle.

- **Input:** region of interest and timestamp from `apps/orchestrator/trigger` (live) or a historical date (training).
- **Output:** one bundle with coordinates, FIRMS detections, weather, topography and Daymet features on a common grid and time base.

## Responsibilities

- Call each `sources/*` module and align results to the project grid.
- Record per-source fetch status and data age so the model and UI can tell missing data from "no fire".
- Run identically for live and historical dates. Training and inference must use this same code path.

## Open questions

- Model cell size inside the 50 km tile, projection, time step.
- Bundle format (schema lives in `shared/`).
- Behaviour when one source fails or times out.
