# inference

Python service: data pipeline and Pyro model, exposed over HTTP with FastAPI. Only `apps/orchestrator` calls it; the web app never does.

- `sources/`: one fetcher per external source
- `harmonization/`: builds the data bundle on a common grid
- `model/training/`, `model/inference/`: fit and run the model
- `shared/`: schemas, grid definition, config

Run `uv sync` here to install dependencies.

## Open questions

- API routes and response schema (must match what the orchestrator and web app expect).
- Port and base URL, read from environment variables on both sides.
- Where the ingestion scheduler runs.
