<p align="center">
  <img src="1000034270.jpg" alt="Pyro mascot: a penguin firefighter in a pink helmet holding flame and star balloons" width="320">
</p>

# Pyro

Interactive US wildfire map: current and predicted fire probability from a Pyro (probabilistic) model that combines NASA FIRMS satellite detections with weather, terrain and fuels.

## Current state (2026-11-15)

| App | What works | Not built yet |
|---|---|---|
| `apps/web` | React/Vite/MapLibre map: national view, state preview, tile heat map with terrain, live/predictive and historical modes. Against the orchestrator it draws the models' risk cells and spread outlines; `VITE_USE_MOCK=true` runs on generated data. | State preview and historical replay with real data. |
| `apps/orchestrator` | Express API. `GET /tiles` fetches FIRMS, NOAA weather (via Open-Meteo), Daymet, USGS 3DEP terrain and LANDFIRE fuels for a 300-square-mile region, posts the bundle to the inference service and returns cells, spread, detections and the bundle (`status: "ready"`; `"observed"` if the models are unavailable). | `GET /states/{fips}/preview` (returns empty); `GET /history/...` routes. |
| `apps/inference` | Python: FIRMS archive tooling, compiled training table, two trained models (occurrence and spread) served by FastAPI (`POST /predict`, `POST /spread`). | Latent-state model; validation of spread against perimeters. |

**The pipeline is connected:** `web -> orchestrator -> five data sources -> inference -> web`. It has been tested with stubbed sources and real model code, not yet with a live fan-out bundle. See [`docs/handover/models.md`](docs/handover/models.md) for what the numbers mean and their limits.

## Run

```bash
npm install
```

Inference (port 8000), from `apps/inference`; needs the trained artifacts in `data/models`:

```bash
uv sync
uv run uvicorn app:app --port 8000
```

Orchestrator (port 3001). Needs `FIRMS_MAP_KEY` and `EARTHDATA_TOKEN`, and `INFERENCE_URL=http://127.0.0.1:8000` for model output; see [`apps/orchestrator/README.md`](apps/orchestrator/README.md).

```bash
cp apps/orchestrator/.env.example apps/orchestrator/.env
npm run dev:orchestrator
```

Web (port 5173). `VITE_USE_MOCK=false` (the example default) calls the orchestrator; `true` uses generated data and needs no backend.

```bash
cp apps/web/.env.example apps/web/.env
npm run dev:web
```

Python (from `apps/inference`):

```bash
uv sync
```

## Tests

```bash
npm test --workspace @pyro/web
```

```bash
npm test --workspace @pyro/orchestrator
```

From `apps/inference` (plain `pytest` cannot find the `shared` package; run it as a module):

```bash
uv run python -m pytest
```

## Docs

- [`apps/README.md`](apps/README.md): app roles, data flow, work items and remaining work.
- Each app and work-item folder has a README with inputs, outputs and open questions.
- [`docs/handover/`](docs/handover/README.md): decisions, data sources, model outline, risks.
