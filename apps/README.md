# apps

| App | Language | Role |
|---|---|---|
| `web/` | TypeScript (React/Vite, MapLibre) | Map site. Talks only to the orchestrator. |
| `orchestrator/` | TypeScript (Express) | Public API. Takes a point, fetches and normalizes every data source for the region around it, and calls the inference service. |
| `inference/` | Python (FastAPI, scikit-learn) | Model training and inference, exposed to the orchestrator over HTTP. A baseline today; the Pyro model is still to build. Also holds the FIRMS archive tooling used for training. |

## Data flow

**Today (2026-11-15):**

```
web --GET /tiles?lat&long--> orchestrator --fanOutEntry--> FIRMS, NOAA (Open-Meteo), Daymet, 3DEP, LANDFIRE
                             orchestrator --POST /predict (dataBundle)--> inference (baseline model)
web <--status "ready": cells + detections + bundle-- orchestrator
       (status "observed", no cells, if inference is down or unset)
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
| `orchestrator/src/app.ts` | 1. HTTP API | `GET /health`, `GET /tiles` (with inference call) and `/history` proxy done. Preview returns empty. |
| `inference/sources/firms/` | 2. FIRMS archive | Done: 21 M detections harmonized. Live FIRMS is in the orchestrator. |
| `inference/sources/weather/` | 2. Weather | Live: orchestrator (NOAA RRFS via Open-Meteo). Historical weather for training: not started. |
| `inference/sources/topography/` | 2. Terrain and fuels | Live: orchestrator (3DEP, LANDFIRE). Historical fuel vintages for training: not started. |
| `inference/sources/daymet/` | 2. Daymet | Retrieval in the orchestrator. Use in training: not started. |
| `inference/harmonization/` | 2. Training bundles and features | First compiled table done (10 km cell-days); live-bundle features in `model/features.py`. |
| `inference/model/training/` | 3. Training | Baseline trained (`train.py`). Latent-sensor model not started. Needs labels (NIFC / WFIGS, unverified). |
| `inference/model/inference/` | 3. Inference service | Done for the baseline: `POST /predict`, `/history`. |
| `inference/shared/` | Schemas and grid | FIRMS schema and 50 km grid done. `dataBundle` schema not mirrored in Python yet. |
| `web/` | Map site | Built; mock and observed-data modes work. Waits on model output. |

Owners are TBD for every item.

## Remaining work

In dependency order. Details are in each folder's README.

1. **Bundle schema in Python.** Mirror `dataBundle` (`orchestrator/src/fan-out/types.ts`) in `inference/shared/` and test against a real `GET /tiles` response. One schema, changed on both sides together.
2. **Model cell grid.** Pick the cells the model predicts on. The fan-out already samples a 28 x 28 grid (about 1 km) over the region; the web mock uses 1 km cells too. Decide whether that is the model grid and how cells map to GeoJSON polygons for the web.
3. **Labels.** Verify NIFC / WFIGS (decision 8) and pull a sample.
4. **Training data.** Produce historical bundles with the same features as live: FIRMS from the harmonized archive, historical weather (Open-Meteo archive or Daymet, checked against the live NOAA weather), LANDFIRE vintages for the training years.
5. **Train** the latent-fire-state model (`docs/handover/model-outline.md`) and version the artifact outside git.
6. **Inference service.** FastAPI `POST` route taking a `dataBundle`, returning per-cell `probability` and `uncertainty` (and later `spread`). Base URL from an environment variable.
7. **Orchestrator integration.** After fan-out, call inference; merge cells into the tile response, set `status: "ready"` and `updatedAt`. If inference fails, still return `observed` data. Report it in `/health`.
8. **Web.** Turn the real output on (it already renders `cells`), decide what the state preview shows, and build `/history` routes and spread on the backend or keep them mock-only.

## Contracts

`web` -> `orchestrator`: `GET /tiles?lat=&long=` is implemented (see `orchestrator/README.md`); `GET /states/{fips}/preview` exists but returns no tiles. `GET /history/...` and the `spread` / `drivers` / `perimeters` fields are web-side proposals in `web/README.md`.

`orchestrator` -> `inference`: `POST /predict` with the `dataBundle`; response validated in `orchestrator/src/inference/client.ts`. Check both sides with `npm run test:integration --workspace @pyro/orchestrator`.

See `docs/handover/` for source decisions and risks.
