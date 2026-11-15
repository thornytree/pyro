# Inference

Implemented in `predict.py`, exposed by `apps/inference/app.py`.

```bash
uv run --directory apps/inference uvicorn app:app --host 127.0.0.1 --port 8000
```

- `GET /health`: loaded model version and target.
- `POST /predict`: accepts the existing `dataBundle` directly.
- Output: GeoJSON `cells`, `updatedAt`, `prediction` metadata.
- Input requires at least 24 aligned consecutive hourly weather values.
- Model loads once from `MODEL_PATH`, default `model/artifacts/baseline.joblib`.

`cells.properties.probability` is a legacy display field containing a relative
FIRMS-detection score on the sampled data; `prediction.scoreKind` makes that
explicit. It is not calibrated burn probability. Uncertainty is twice the score
standard deviation across five bootstrap members. Native 10 km scores are mapped
to display polygons without claiming added resolution.

The TS client validates the complete geographic output and forecast window before
merging it into `/tiles` as `ready`. Model unavailability falls back to successful
source observations. See the [service README](../../README.md) for the contract,
training/serving differences, tests and restrictions.
