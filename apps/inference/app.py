"""FastAPI inference service. Run from apps/inference: uv run uvicorn app:app --port 8000."""
from contextlib import asynccontextmanager
import os
from pathlib import Path
from datetime import date

from fastapi import Query
from model.inference.history import HistoryArchive

from fastapi import FastAPI, HTTPException

from threadpoolctl import threadpool_limits

from model.inference.predict import Predictor
from model.training.train import train
from model.schema import PredictionBundle

ROOT = Path(__file__).resolve().parent
TRAINING_FILES = ("train.csv.gz", "validation.csv.gz", "test.csv.gz", "columns.json")


def create_app(model_path: Path | None = None, data_dir: Path | None = None):
    path = model_path or Path(os.getenv("MODEL_PATH", "model/artifacts/baseline.joblib"))
    if not path.is_absolute():
        path = ROOT / path

    data = data_dir or Path(os.getenv("TRAINING_DATA_DIR", "training/compiled"))
    if not data.is_absolute():
        data = ROOT / data

    @asynccontextmanager
    async def lifespan(app):
        if not path.is_file():
            # The artifact is a build product (ignored by Git); the compiled table is committed.
            if not all((data / name).is_file() for name in TRAINING_FILES):
                raise RuntimeError(
                    f"Model artifact {path} is missing and {data} lacks {', '.join(TRAINING_FILES)}. "
                    "Restore the compiled training table or set MODEL_PATH.")
            print(f"Model artifact missing; training from {data} (first start only).", flush=True)
            with threadpool_limits(limits=1):
                # Keep the tracked report.json untouched: this is a rebuild, not a new experiment.
                train(data, path, path.with_suffix(".report.json"))
        app.state.predictor = Predictor(path)
        app.state.history = HistoryArchive(data / "test.csv.gz", app.state.predictor)
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
