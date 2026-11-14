# Pyro

- `apps/web`: React/Vite map site (MapLibre). National view, state preview, tile heat map with terrain. Live/predictive mode only; the historical mode and the switch between them are not built yet. Runs on mock data until the orchestrator serves tiles; see `apps/web/README.md`.
- `apps/orchestrator`: TypeScript/Express server. Runs scheduled FIRMS and Open-Meteo ingestion when `FIRMS_MAP_KEY` is set; no tile routes yet.
- `apps/inference`: Python. FIRMS archive normalizer and loader, 50 km tile grid. FastAPI service and model not started.

Run `npm install`, then `npm run dev:orchestrator` (port 3001) or `npm run dev:web` (port 5173).
For Python dependencies, run `uv sync` in `apps/inference`.

Web tests: `npm test --workspace @pyro/web`.

Work items and data flow: `apps/README.md`. Source decisions, risks and model outline: `docs/handover/`.
