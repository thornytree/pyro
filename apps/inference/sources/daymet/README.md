# sources/daymet

Work item 2: Daymet gridded daily surface weather (1 km), hosted by NASA's ORNL DAAC.

**Role: historical weather context and training.** Fan-out includes it under
`historical_weather` for an explicit caller-selected date range. It does not replace
current NOAA weather or imply that historical values are current conditions.

- **Input:** coordinates or tile, historical date range.
- **Output:** daily weather variables per grid cell for training bundles.

## Risk

The model can only use features that also exist at inference. Each Daymet variable used in training must have an Open-Meteo equivalent at serve time, and the two products will differ. Compare them on an overlapping period before training on Daymet.

## Implemented retrieval adapter

Historical regional retrieval is implemented in
[`apps/orchestrator/src/fan-out/daymet.ts`](../../../orchestrator/src/fan-out/daymet.ts).
It uses the same 300-square-mile region as the live sources and fetches bulk NetCDF
subsets rather than individual pixels. See the orchestrator fan-out README for the
JSON layout, common-grid mapping, required Earthdata access and validation status.
