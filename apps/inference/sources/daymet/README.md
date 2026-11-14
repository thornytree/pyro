# sources/daymet

Work item 2: Daymet gridded daily surface weather (1 km), hosted by NASA's ORNL DAAC.

**Role: training only** (decided 2026-11-14). Not part of the real-time bundle.

- **Input:** coordinates or tile, historical date range.
- **Output:** daily weather variables per grid cell for training bundles.

## Risk

The model can only use features that also exist at inference. Each Daymet variable used in training must have an Open-Meteo equivalent at serve time, and the two products will differ. Compare them on an overlapping period before training on Daymet.
