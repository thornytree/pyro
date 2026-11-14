# apps

| App | Language | Role |
|---|---|---|
| `web/` | TypeScript (React/Vite) | Map site. Talks only to the orchestrator. |
| `orchestrator/` | TypeScript (Express) | Public API. Receives user requests, resolves tiles, calls the inference API. |
| `inference/` | Python (FastAPI) | Data pipeline and Pyro model, exposed to the orchestrator over HTTP. |

## Work items

| Folder | Work item | Owner |
|---|---|---|
| `orchestrator/trigger/` | 1. User trigger inputs (lat/long) | TBD |
| `inference/sources/firms/` | 2. FIRMS MODIS and VIIRS detections | TBD |
| `inference/sources/weather/` | 2. Weather | TBD |
| `inference/sources/topography/` | 2. Terrain and elevation | TBD |
| `inference/sources/daymet/` | 2. Daymet | TBD |
| `inference/harmonization/` | 2. Builds the harmonized data bundle | TBD |
| `inference/model/training/` | 3. Training on historical inputs and outcomes | TBD |
| `inference/model/inference/` | 3. Inference on the real-time bundle | TBD |
| `inference/shared/` | Schemas and config used by more than one inference folder | TBD |

Data flow: `web` -> `orchestrator/trigger` -> inference API -> `sources/*` -> `harmonization` -> `model/inference` -> response.
Training uses the same `sources/*` and `harmonization` code on historical dates, so features match at train and serve time.

Each folder's README states its inputs, outputs and open questions. See `docs/handover/` for source decisions and risks.
