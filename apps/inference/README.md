# inference

Python: model training and inference, exposed over HTTP with FastAPI. Only `apps/orchestrator` calls it; the web app never does.

## Status (2026-11-15)

| Folder | State |
|---|---|
| `sources/firms/` | Done: FIRMS archive normalizer and loader (`archive.py`, `normalize.py`). |
| `shared/` | Done: unified FIRMS schema, 50 km EPSG:5070 tile grid. |
| `sources/{weather,topography,daymet}/` | No Python code. Live retrieval lives in `apps/orchestrator/src/fan-out/`; these READMEs point there. |
| `harmonization/` | Training side done: FIRMS per cell-day, sample, and the compiled train / validation / test table (`compile_dataset.py`; see `docs/handover/compiled-dataset.md`). Features from a live bundle: not started. |
| `model/training/`, `model/inference/` | Not started. |
| FastAPI app | Not started. `fastapi` and `uvicorn` are dependencies, but there is no app module or route. |

The orchestrator now fetches and normalizes every source itself and reports `inference: "not_connected"` in `/health`. This service's job is to take that normalized `dataBundle` and return model output.

## To build

1. `shared/`: a Python mirror of the orchestrator's `dataBundle` type (`apps/orchestrator/src/fan-out/types.ts`), validated against a real `GET /tiles` response.
2. `harmonization/`: turn a bundle into model features, the same way for live and historical bundles.
3. `model/training/`: fit the model on historical bundles and NIFC / WFIGS labels.
4. `model/inference/` plus an app module: a FastAPI `POST` route taking a bundle and returning per-cell `probability` and `uncertainty`. See `model/inference/README.md` for the proposed shape.

## Run

```bash
uv sync
```

Tests (as a module, so `shared` and `sources` import from this folder):

```bash
uv run python -m pytest
```

## Open questions

- Route path, request and response schema, and latency budget for the inference call.
- Port and base URL, read from environment variables on both sides (`INFERENCE_URL` or similar in the orchestrator).
- Whether historical training bundles come from the TypeScript fan-out (called with past dates) or a Python port of it.
