# Backend

| Folder | Work item | Owner |
|---|---|---|
| `trigger/` | 1. User trigger inputs (lat/long) | TBD |
| `sources/firms/` | 2. FIRMS MODIS and VIIRS detections | TBD |
| `sources/weather/` | 2. Weather | TBD |
| `sources/topography/` | 2. Terrain and elevation | TBD |
| `sources/daymet/` | 2. Daymet | TBD |
| `harmonization/` | 2. Builds the harmonized data bundle | TBD |
| `model/training/` | 3. Training on historical inputs and outcomes | TBD |
| `model/inference/` | 3. Inference on the real-time bundle | TBD |
| `shared/` | Schemas and config used by more than one folder | TBD |

Data flow: `trigger` -> `sources/*` -> `harmonization` -> `model/inference` -> response.
Training uses the same `sources/*` and `harmonization` code on historical dates, so features match at train and serve time.

Each folder's README states its inputs, outputs and open questions. See `docs/handover/` for source decisions and risks.
