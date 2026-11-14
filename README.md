# Pyro

- `apps/web`: React/Vite map site (MapLibre). Runs on mock data until the orchestrator serves tiles; see `apps/web/README.md`.
- `apps/orchestrator`: TypeScript/Express hello-world server.
- `apps/inference`: Python dependency configuration for FastAPI.

Run `npm install`, then `npm run dev:orchestrator` (port 3001) or `npm run dev:web` (port 5173).
For Python dependencies, run `uv sync` in `apps/inference`.

Work items and data flow: `apps/README.md`. Source decisions, risks and model outline: `docs/handover/`.
