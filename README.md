# Pyro

Interactive US wildfire map: current and predicted fire probability from a Pyro (probabilistic) model that combines NASA FIRMS satellite detections with weather, terrain and fuels.

## Current state (2026-11-15)

| App | What works | Not built yet |
|---|---|---|
| `apps/web` | React/Vite/MapLibre map: national view, state preview, tile heat map with terrain, live/predictive and historical modes, experimental predicted spread. Calls the orchestrator, or runs on generated mock data. | Rendering real model output (none exists yet). |
| `apps/orchestrator` | Express API. `GET /tiles` fetches FIRMS, NOAA weather (via Open-Meteo), Daymet, USGS 3DEP terrain and LANDFIRE fuels for a 300-square-mile region and returns real detections plus the full source bundle (`status: "observed"`). | Calling the inference service; `GET /states/{fips}/preview` (returns empty); `GET /history/...` routes. |
| `apps/inference` | Python: FIRMS archive normalizer and loader (21 M harmonized detections), 50 km tile grid, schema. | FastAPI service, feature building, model training and inference. |

**The main gap is the model.** The pipeline today is `web -> orchestrator -> five data sources -> web`, and it stops at observations. Nothing trains or runs the Pyro model, and the orchestrator has no inference call. See "Remaining work" in [`apps/README.md`](apps/README.md).

## Run

```bash
npm install
```

Orchestrator (port 3001). Needs `FIRMS_MAP_KEY` and `EARTHDATA_TOKEN`; see [`apps/orchestrator/README.md`](apps/orchestrator/README.md).

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
