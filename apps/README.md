# apps

| App | Language | Role |
|---|---|---|
| `web/` | TypeScript (React/Vite, MapLibre) | Map site. Talks only to the orchestrator. |
| `orchestrator/` | TypeScript (Express) | Public API. Takes a point, fetches and normalizes every data source for the region around it, and (to build) calls the inference service. |
| `inference/` | Python (FastAPI, Pyro) | Model training and inference, exposed to the orchestrator over HTTP (to build). Also holds the FIRMS archive tooling used for training. |

## Data flow

**Today (2026-11-15):**

```
web --GET /tiles?lat&long--> orchestrator --fanOutEntry--> FIRMS, NOAA (Open-Meteo), Daymet, 3DEP, LANDFIRE
                             orchestrator --POST /predict, POST /spread (bundle)--> inference
web <--status "ready": cells, spread, drivers, detections, bundle-- orchestrator
web <--status "observed": detections + bundle, if inference is off or fails-- orchestrator
```

**Target:**

```
web -> orchestrator -> sources (fan-out) -> dataBundle -> inference API (POST) -> cells, uncertainty, spread
    <- orchestrator merges model output into the tile response (status "ready")
```

Source retrieval moved into the orchestrator (`orchestrator/src/fan-out/`). The Python `sources/*` folders now hold archive and training-side code only; the inference service is meant to receive the normalized `dataBundle` JSON rather than fetch rasters itself.

Training should use the same features the orchestrator builds at serve time. How historical bundles are produced for training (call the TypeScript fan-out with past dates, or port it) is open; see "Remaining work".

## Work items

| Folder | Work item | Status |
|---|---|---|
| `orchestrator/src/fan-out/` | 1. Point input, region, source retrieval and normalization | Done for live requests (all five sources). Optional scheduled 50 km grid path exists but is not started. |
| `orchestrator/src/app.ts` | 1. HTTP API | `GET /health`, `GET /tiles` with model output done. Preview returns empty. No `/history` routes. |
| `inference/sources/firms/` | 2. FIRMS archive | Done: 21 M detections harmonized. Live FIRMS is in the orchestrator. |
| `inference/sources/weather/` | 2. Weather | Live: orchestrator (NOAA RRFS via Open-Meteo). Historical weather for training: not started. |
| `inference/sources/topography/` | 2. Terrain and fuels | Live: orchestrator (3DEP, LANDFIRE). Historical fuel vintages for training: not started. |
| `inference/sources/daymet/` | 2. Daymet | Retrieval in the orchestrator. Use in training: not started. |
| `inference/harmonization/` | 2. Training bundles and features | Compiled training table and live bundle features done. |
| `inference/model/training/` | 3. Training | Occurrence and spread models trained (`docs/handover/models.md`). Latent-state model still needs labels (NIFC / WFIGS, unverified). |
| `inference/model/inference/` | 3. Inference service | `POST /predict` and `POST /spread`, called by the orchestrator on every `/tiles` request. |
| `inference/shared/` | Schemas and grid | FIRMS schema and 50 km grid done. `dataBundle` schema not mirrored in Python yet. |
| `web/` | Map site | Built; mock, observed-data and model-output modes work. |

Owners are TBD for every item.

## Remaining work

In dependency order. Details are in each folder's README.

1. **Bundle schema in Python.** Mirror `dataBundle` (`orchestrator/src/fan-out/types.ts`) in `inference/shared/` and test against a real `GET /tiles` response. One schema, changed on both sides together.
2. **Model cell grid.** Pick the cells the model predicts on. The fan-out already samples a 28 x 28 grid (about 1 km) over the region; the web mock uses 1 km cells too. Decide whether that is the model grid and how cells map to GeoJSON polygons for the web.
3. **Labels.** Verify NIFC / WFIGS (decision 8) and pull a sample.
4. **Training data.** Produce historical bundles with the same features as live: FIRMS from the harmonized archive, historical weather (Open-Meteo archive or Daymet, checked against the live NOAA weather), LANDFIRE vintages for the training years.
5. **Train** the latent-fire-state model (`docs/handover/model-outline.md`) and version the artifact outside git.
6. **Inference service.** Done for the classifier and spread models: `POST /predict`, `POST /spread` (`inference/app.py`).
7. **Orchestrator integration.** Done (`orchestrator/src/inference.ts`, `INFERENCE_URL`). Still to do: run it against a real fan-out bundle.
8. **Web.** Real cells and spread are rendered. Still to do: decide what the state preview shows, and build `/history` routes or keep them mock-only.

## Contracts

`web` -> `orchestrator`: `GET /tiles?lat=&long=` is implemented (see `orchestrator/README.md`); `GET /states/{fips}/preview` exists but returns no tiles. `GET /history/...` and the `spread` / `drivers` / `perimeters` fields are web-side proposals in `web/README.md`.

`orchestrator` -> `inference`: `POST /predict` and `POST /spread` with the `dataBundle` minus `historical_weather`; responses in `inference/model/inference/README.md`, merging in `orchestrator/README.md`.

See `docs/handover/` for source decisions and risks.
