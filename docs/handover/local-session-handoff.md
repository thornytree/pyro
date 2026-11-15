# Handoff: install the training table and verify the model end to end

Written 2026-11-15 for a local session on the machine that has the training zip.
Delete this file once the steps below are done.

## Goal

Get the real trained model serving the web map. The code is finished on branch
`claude/sleepy-hopper-vgqlhl`. The only missing piece is the compiled training
table, which is in a zip on the local machine and was too large to upload to the
cloud session that did the code work.

## Why the model was not feeding the front end

The trained artifact (`apps/inference/model/artifacts/baseline.joblib`) and its
training table were both gitignored. On any fresh clone the Python inference
service crashed at startup, and the orchestrator silently fell back to
`status: "observed"` with no cells, so the map showed "Live observations".

## Already done on the branch

- `apps/inference/app.py`: if the artifact is missing, the service trains it on
  first start from `apps/inference/training/compiled`. Paths can be overridden
  with `MODEL_PATH` and `TRAINING_DATA_DIR`. The rebuild writes
  `baseline.report.json` next to the artifact and leaves the tracked
  `apps/inference/model/training/report.json` alone.
- `.gitignore`: allows exactly four files under
  `apps/inference/training/compiled/`: `train.csv.gz`, `validation.csv.gz`,
  `test.csv.gz`, `columns.json`. Everything else under
  `apps/inference/training/` and the artifact directory stay ignored.
- `apps/orchestrator/src/app.ts`: logs each failed inference call; `GET /health`
  probes the model service and reports `inference` as `ready` (with
  `modelVersion`), `unreachable` or `not_connected`; fetches at least 24 forecast
  hours when inference is configured.
- Scripts: `npm run dev:inference` and
  `npm run test:integration --workspace @pyro/orchestrator`.
- READMEs updated to match the running system.

Tests at handoff: 29 orchestrator, 111 web, 24 Python, all passing. The
first-start training and the integration check were exercised with a synthetic
table only, never with the real data.

## Steps for the local session

1. Check out the branch.

   ```bash
   git fetch origin claude/sleepy-hopper-vgqlhl
   ```

   ```bash
   git checkout claude/sleepy-hopper-vgqlhl
   ```

2. Find the four files in the zip: `train.csv.gz`, `validation.csv.gz`,
   `test.csv.gz` and `columns.json`. They are the output of
   `apps/inference/harmonization/compile_dataset.py`, normally under
   `training/compiled/`.

3. Copy only those four files to `apps/inference/training/compiled/`. Do not add
   raw source data to git (FIRMS archive, Daymet, LANDFIRE, Open-Meteo history,
   `dataset.csv.gz`, `parts/`). If any of the four is larger than about 50 MB,
   stop and decide on storage before committing.

4. Check the files are the ones the recorded model was trained on. Their SHA-256
   hashes should match `data_sha256` in
   `apps/inference/model/training/report.json`:

   | File | Hash starts with |
   |---|---|
   | `train.csv.gz` | `3716cd27` |
   | `validation.csv.gz` | `c71202f5` |
   | `test.csv.gz` | `82cd1d51` |

   If they differ, the table has been recompiled since the report was written.
   The model will still build, but its version and metrics will not match.

5. Install and start inference.

   ```bash
   npm install
   ```

   ```bash
   npm run dev:inference
   ```

   The first start should print `Model artifact missing; training from ...` and
   then serve on port 8000. `GET http://127.0.0.1:8000/health` should report
   `modelVersion` `daily-detection-v1-3716cd27-hgb15` if the hashes matched.
   Compare `apps/inference/model/artifacts/baseline.report.json` with the tracked
   `report.json` (test ROC-AUC about 0.758, average precision about 0.759).

6. Run the checks, with inference still running.

   ```bash
   npm run test:integration --workspace @pyro/orchestrator
   ```

   Expect `ok: 784 cells from ...`.

   ```bash
   npm test --workspace @pyro/orchestrator
   ```

   ```bash
   npm test --workspace @pyro/web
   ```

   From `apps/inference`:

   ```bash
   uv run python -m pytest
   ```

   `GET http://127.0.0.1:8000/history/examples` should now return 200, since
   `test.csv.gz` exists.

7. Check the local environment files.
   - `apps/orchestrator/.env` must contain `INFERENCE_URL=http://127.0.0.1:8000`.
     Copies made before that variable existed will not have it.
   - `apps/web/.env` must have `VITE_USE_MOCK=false`.
   - The orchestrator needs real `FIRMS_MAP_KEY` and `EARTHDATA_TOKEN`.

8. Run the whole system and look at the map.

   ```bash
   npm run dev:orchestrator
   ```

   ```bash
   npm run dev:web
   ```

   `http://localhost:3001/health` should show `inference: "ready"`. Click a tile:
   the banner should read "Experimental daily fire score" with coloured cells. If
   it reads "Live observations", the orchestrator console logs the reason.

9. Commit the four data files, and nothing else from the zip, on
   `claude/sleepy-hopper-vgqlhl` and push. Remove this file in the same commit.

## Known gaps, not part of this handoff

- A tile returns 502 if any one of the five sources fails, although the model
  only uses the Open-Meteo weather.
- `GET /states/{fips}/preview` always returns empty.
- The model is a scikit-learn baseline with sample-relative scores, not the
  planned latent-sensor Pyro model. It ignores FIRMS detections, fuels and
  terrain slope, and there is no spread model.
- No CI, and no shared bundle schema between TypeScript and Python beyond the
  integration check above.
