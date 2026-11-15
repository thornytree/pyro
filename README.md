<p align="center">
  <img src="1000034270.jpg" alt="Pyro mascot: a penguin firefighter in a pink helmet holding flame and star balloons" width="320">
</p>

# Pyro

Interactive US wildfire map: current and predicted fire probability from a Pyro (probabilistic) model that combines NASA FIRMS satellite detections with weather, terrain and fuels.

## Current state (2026-11-15)

| App | What works | Not built yet |
|---|---|---|
| `apps/web` | React/Vite/MapLibre map: national view, state preview, tile heat map with terrain, live and historical modes. Renders model cells from the orchestrator, or runs on generated mock data. | Spread outlines against real data (mock only). |
| `apps/orchestrator` | Express API. `GET /tiles` fetches FIRMS, NOAA weather (via Open-Meteo), Daymet, USGS 3DEP terrain and LANDFIRE fuels for a 300-square-mile region, POSTs the bundle to the inference service and returns model cells (`status: "ready"`). Falls back to observations (`status: "observed"`) if inference fails. `GET /history/...` proxies the held-out archive. | `GET /states/{fips}/preview` (returns empty); partial results when one source fails. |
| `apps/inference` | Python FastAPI service: experimental daily FIRMS-detection baseline (gradient-boosted ensemble), `POST /predict`, `/history` replay, training code, FIRMS archive tooling. | The planned latent-sensor Pyro model, calibrated probabilities, spread. |

The pipeline is `web -> orchestrator -> five data sources -> inference -> web`. The model is a first baseline: its scores are relative to a balanced training sample, not calibrated burn probabilities. See [`apps/inference/README.md`](apps/inference/README.md).

If the map shows "Live observations" instead of scores, open `http://localhost:3001/health`: `inference` is `ready`, `unreachable` (inference service not running) or `not_connected` (`INFERENCE_URL` unset). The orchestrator also logs the reason for each failed inference call.

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

Inference (port 8000). The trained artifact is not in Git; on first start the service trains it (a few seconds) from the compiled table in `apps/inference/training/compiled`. Start it before the orchestrator.

```bash
npm run dev:inference
```

## Tests

```bash
npm test --workspace @pyro/web
```

```bash
npm test --workspace @pyro/orchestrator
```

End-to-end contract check, orchestrator to a running inference service:

```bash
npm run test:integration --workspace @pyro/orchestrator
```

From `apps/inference` (plain `pytest` cannot find the `shared` package; run it as a module):

```bash
uv run python -m pytest
```

## Docs

- [`apps/README.md`](apps/README.md): app roles, data flow, work items and remaining work.
- Each app and work-item folder has a README with inputs, outputs and open questions.
- [`docs/handover/`](docs/handover/README.md): decisions, data sources, model outline, risks.
