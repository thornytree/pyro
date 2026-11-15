# Python training and inference

A trained experimental daily fire-detection baseline is implemented and connected
to the TypeScript orchestrator. It is a CPU gradient-boosted ensemble, not the
planned latent-sensor Pyro model or a spread/perimeter simulator.

## Start

From the repo root:

```bash
uv sync --directory apps/inference --locked
uv run --directory apps/inference uvicorn app:app --host 127.0.0.1 --port 8000
```

`GET http://127.0.0.1:8000/health` reports the loaded model version.
`POST /predict` takes the existing orchestrator `dataBundle` directly as JSON.
The trained artifact is `model/artifacts/baseline.joblib`, ignored by Git. If it is
missing, the service trains it on first start from `training/compiled`
(`train.csv.gz`, `validation.csv.gz`, `test.csv.gz`, `columns.json`, committed) and
writes its report next to the artifact, leaving the tracked `report.json` alone.
Startup fails only if both the artifact and that table are missing. Override the
paths with `MODEL_PATH` and `TRAINING_DATA_DIR` (relative to `apps/inference`).
For a separate machine, copy the artifact, run the same locked environment, bind
to the appropriate interface, and set the orchestrator's `INFERENCE_URL` to it.
Restart inference after replacing its artifact; it is loaded once at startup.

## Retrain

The compiled table is committed under `apps/inference/training/compiled`. After
recompiling (`harmonization/compile_dataset.py` writes to `<data>/training/compiled`),
copy the three splits and `columns.json` there. No sources are downloaded or
training labels regenerated.

```bash
uv run --directory apps/inference python -m model.training.train --data training/compiled
```

Training fits five bootstrap members for each of three small candidates, selects
by validation average precision, and evaluates the held-out test split only after
selection. It checks chronological separation, duplicate cell-days, feature roles,
binary labels and finite inputs. The seed and SHA-256 hashes are saved in
[`model/training/report.json`](model/training/report.json), along with all metrics.

| Split | Rows | ROC-AUC | Average precision |
|---|---:|---:|---:|
| Train | 4,845 | 0.892 | 0.886 |
| Validation | 1,617 | 0.763 | 0.731 |
| Test | 1,609 | 0.758 | 0.759 |

The constant-score test average precision is 0.509. These are metrics on the
supplied sampled dataset, not estimates of operational wildfire accuracy.

## Meaning and limits

- Target: any FIRMS vegetation-fire detection in a native 10 km cell-day, not
  independently confirmed wildfire, burned area or fire progression.
- Scores are relative to the approximately balanced fire/background sample. The
  background cells were sampled from fire-prone areas; deployment prevalence is
  unknown. Scores are not calibrated real-world burn probabilities.
- Only 18 reproducible features are used: location/season and daily weather,
  including weather-provider elevation. Same-day FIRMS details and labels are
  excluded. Old Daymet context, unavailable long fire histories, fuel/canopy
  columns absent from training, and incompatible terrain summaries are not fed
  to this baseline. They remain available in the bundle for future models.
- Training uses retrospective local-solar daily weather. Serving uses the first
  24 consecutive hourly NOAA RRFS forecasts. The local-solar date of the window
  midpoint supplies seasonality. This forecast/reanalysis and calendar-window
  shift has not been validated against a prospective forecast dataset.
- Native model resolution is 10 km. Samples are aggregated into native cells,
  using only the portion inside the requested region; edges may be partial.
  Native scores are repeated across the existing ~1 km display grid, not
  downscaled to new 1 km skill.
- Uncertainty is twice the bootstrap members' score standard deviation, bounded
  to 0–1. It measures ensemble disagreement, not a calibrated credible interval.
- This model does not predict spread direction, speed or future perimeters.

## Contract

The model validates only its consumed bundle fields: selected point, ordered
bounds, complete row-major grid, sample references, finite weather/elevation,
valid humidity/wind/rain ranges, and at least 24 aligned consecutive hourly values.
Other provider fields are accepted and ignored. Invalid inputs return HTTP 422.
Requests containing fewer than 24 hours are unsupported; if more are supplied,
only the first 24 hours are scored. The response states the exact window.

Response fields: `cells` (GeoJSON polygons with legacy map properties `probability`
and `uncertainty`, plus `nativeCellId`), `updatedAt`, and `prediction` metadata.
`prediction.scoreKind = "sample_relative"` defines the meaning of the legacy
`probability` field. Other metadata identifies the target, version, 24h window,
10 km native resolution, native cell count and uncertainty definition. No spread,
perimeter or sensor-confidence values are invented.

The orchestrator checks output coverage, score ranges, geometry and forecast
window before returning `status: "ready"`. Inference errors/timeouts preserve the
successful source bundle as `observed` with an `inference.unavailable` notice.
Required source failures still return 502; connecting a model does not relax that.

## Verification

```bash
uv run --directory apps/inference python -m pytest tests
```

Tests cover training/serving feature parity (including km/h → m/s), absence of
same-day fire leakage, validation, model loading and geographic score output.
The real trained artifact was also checked over HTTP through the frontend client,
Express and FastAPI, using a source-data fixture to isolate model integration from
provider availability. Model requests in that integration used real inference.

## Historical replay API

`GET /history/examples` lists positive held-out test cell-days from the supplied
`training/compiled/test.csv.gz`. `GET /history/tiles?lat=47.6497&long=-120.3906&date=2025-09-22`
scores available archived rows with the loaded ensemble. No live data is fetched.
Only sampled native 10 km cells are drawn, clipped to the 300-square-mile region.
No samples returns 404; a missing archive returns 503. Labels/counts are returned
separately from the 18 model features. Counts cover full native cells; exact
hotspots and perimeters are unavailable. Dates refer to local-solar archive days;
midnight timestamps identify those days, not exact acquisitions or forecast issues.
This is retrospective reconstruction, not validated spread.
