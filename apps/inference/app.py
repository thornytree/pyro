"""FastAPI service: model output for the orchestrator's `dataBundle`.

    uv run uvicorn app:app --port 8000

Run it from apps/inference. Artifacts are read from PYRO_MODEL_DIR, or
<PYRO_DATA_DIR or repo>/data/models.
"""
from __future__ import annotations

from fastapi import Body, FastAPI, HTTPException

from harmonization.bundle_features import BundleError
from model.inference import artifacts, occurrence, spread

app = FastAPI(title="pyro inference", version="0.1.0")


def _run(predict, load_artifact, bundle: dict) -> dict:
    try:
        return predict(bundle, load_artifact(), artifacts.fire_days())
    except artifacts.ModelNotTrained as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except (BundleError, KeyError, TypeError) as error:
        raise HTTPException(status_code=422, detail=f"Invalid dataBundle: {error!r}") from error


@app.get("/health")
def health() -> dict:
    status = {}
    for name, load in (("occurrence", artifacts.occurrence), ("spread", artifacts.spread)):
        try:
            status[name] = load()["version"]
        except artifacts.ModelNotTrained:
            status[name] = None
    return {"status": "ok" if all(status.values()) else "models_missing", "models": status}


@app.post("/predict")
def predict(bundle: dict = Body(...)) -> dict:
    """Model 1: per-cell probability of a fire detection over the next day."""
    return _run(occurrence.predict_bundle, artifacts.occurrence, bundle)


@app.post("/spread")
def predict_spread(bundle: dict = Body(...)) -> dict:
    """Model 2: 6, 12 and 24 h spread from the bundle's confirmed detections."""
    return _run(spread.predict_bundle, artifacts.spread, bundle)
