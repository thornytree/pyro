"""FastAPI inference service. Run from apps/inference: uv run uvicorn app:app --port 8000."""
from contextlib import asynccontextmanager
import os
from pathlib import Path
from datetime import date

from fastapi import Query
from model.inference.history import HistoryArchive

from fastapi import FastAPI, HTTPException

from model.inference.predict import Predictor
from model.schema import PredictionBundle

ROOT = Path(__file__).resolve().parent


def create_app(model_path: Path | None = None):
    path = model_path or Path(os.getenv("MODEL_PATH", "model/artifacts/baseline.joblib"))
    if not path.is_absolute():
        path = ROOT / path

    @asynccontextmanager
    async def lifespan(app):
        if not path.is_file():
            raise RuntimeError("Model artifact missing. Run: uv run python -m model.training.train --data training/compiled")
        app.state.predictor = Predictor(path)
        app.state.history = HistoryArchive(ROOT / "training/compiled/test.csv.gz", app.state.predictor)
        yield

    service = FastAPI(title="Pyro experimental fire-detection baseline", lifespan=lifespan)

    @service.get("/health")
    def health():
        metadata = service.state.predictor.metadata
        return {"status": "ok", "modelVersion": metadata["model_version"],
                "target": metadata["target"], "scoreKind": "sample_relative", "nativeResolutionKm": 10}

    @service.get("/history/examples")
    def examples():
        try:
            return service.state.history.examples()
        except FileNotFoundError:
            raise HTTPException(status_code=503, detail="Historical archive is not installed")

    @service.get("/history/tiles")
    def history_tile(date: date, lat: float = Query(ge=24.4, le=49.4), long: float = Query(ge=-125, le=-66.9)):
        try:
            return service.state.history.tile(lat, long, date)
        except FileNotFoundError:
            raise HTTPException(status_code=503, detail="Historical archive is not installed")
        except ValueError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error

    @service.post("/predict")
    def predict(bundle: PredictionBundle):
        try:
            return service.state.predictor.predict(bundle)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    return service


app = create_app()
