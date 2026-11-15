# sources/weather

Work item 2: meteorological data.

## Live: implemented in the orchestrator

[`apps/orchestrator/src/fan-out/meteo.ts`](../../../orchestrator/src/fan-out/meteo.ts) requests NOAA RRFS CONUS through Open-Meteo for 100 points across the region plus the selected point: current and hourly temperature, humidity, wind speed, direction and gusts, precipitation, vapour pressure deficit and solar radiation. See the fan-out README for details.

## Training: not started

- RRFS through Open-Meteo has little history, so training needs another product (Open-Meteo Historical Weather API, or Daymet, which the fan-out already fetches for an explicit date range).
- Whatever is used must produce the same variables as the live feed. Compare the two on an overlapping period before training.
- HRRR is discontinued on 2026-11-30; do not build on it.
- Open-Meteo free-tier limits and non-commercial terms still need checking.
