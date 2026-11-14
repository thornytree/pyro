# Pyro

- `apps/web`: React/Vite configuration; frontend source to follow.
- `apps/orchestrator`: TypeScript/Express hello-world server.
- `apps/inference`: Python dependency configuration for FastAPI.

Run `npm install`, then `npm run dev:orchestrator` (port 3001).
For Python dependencies, run `uv sync` in `apps/inference`.

Work items and data flow: `apps/README.md`. Source decisions, risks and model outline: `docs/handover/`.
