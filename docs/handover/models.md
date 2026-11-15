# The two models

2026-11-15

Both are trained, saved under `data/models` (gitignored) and served by `apps/inference/app.py`. The orchestrator calls both on every `GET /tiles`. Neither has been run against a real fan-out bundle yet.

| | Model 1: occurrence | Model 2: spread |
|---|---|---|
| Question | How likely is a fire detection in this cell over the next day? | A fire is confirmed: where will it be in 6, 12 and 24 h? |
| Route | `POST /predict` | `POST /spread` |
| Trained on | Compiled table, 6,462 cell-days (train + validation) | 5.6 M source-target pairs from the FIRMS archive |
| Test result | AUC 0.87 on 1,609 later cell-days | AUC 0.75; predicted and observed rates agree within 2 points per bin |
| Code | `model/training/train_occurrence.py`, `model/inference/occurrence.py` | `model/training/train_spread.py`, `model/inference/spread.py` |

Features from a live bundle: `harmonization/bundle_features.py`.

## Model 1: occurrence

- **What it is.** A logistic regression (20 bootstrap copies) on 31 inputs: place and season, 7 FIRMS history counts, 13 same-day weather values, 7 terrain values. Gradient boosting was tried and scored the same on validation (AUC 0.850 against 0.851); the script picks whichever has the lower validation log loss on each run.
- **Only live-available inputs.** Daymet, soil moisture, the 6-day weather history, `year` and `firms_sensors_active` are left out because the live bundle cannot supply them or they shift between subsets. Cost: AUC 0.846 against 0.851 with every column.
- **Fire history carries most of it.** History alone gives AUC 0.81; weather and terrain alone 0.76.
- **"Compare with historical data"** is the history inputs: fire days in the cell and its neighbours over the last 1, 7, 30 and 365 days, from the FIRMS archive index (`fire_days.npy`) plus the bundle's own detections.
- **`probability` is rescaled to the real fire rate.** The table is half fire rows by construction. The real rate is 1.42% of cell-days (2023 to 2025, cells that have ever burned), so a balanced score of 0.9 becomes 11% and 0.99 becomes 59%. `riskScore` is the unscaled 0 to 1 score, better for colouring a map.
- **`uncertainty`** is twice the standard deviation of the score across the 20 copies, capped at 1.
- **Prediction day** is the local solar day after the bundle's observation time. Weather is the bundle's forecast hours.
- **Per 1 km cell:** weather from its Open-Meteo sample, terrain over an 11 km window, fire history of its 10 km project cell. The probability still means "per 10 km cell-day".

### Relation to decision 9

Decision 9 chose a latent fire state with per-sensor likelihoods and rejected a plain classifier. That model cannot be trained yet (no overpass masks, no WFIGS labels). Chosen 2026-11-15: build the classifier now as the **prior term** of that model. Per-sensor likelihoods then multiply its odds; nothing here has to be thrown away. Needs team confirmation.

## Model 2: spread

**Part a, learned from FIRMS (10 km, daily).** Each burning cell-day is paired with its 8 neighbours and with 8 control cells 50 km away. A boosted classifier predicts "fire in the target tomorrow, given none today". Spread probability is the adjacent prediction minus the control prediction, which removes fire that turns up nearby for unrelated reasons (burning seasons).

| Detections in the source cell | Spread probability to a neighbour (test) |
|---|---|
| 1 | 0.5% |
| 2 to 4 | 0.8% |
| 5 to 19 | 1.3% |
| 20 to 99 | 1.9% |
| 100 to 299 | 3.3% |
| 300 or more | 5.3% |

The control matters: neighbours catch fire the next day 4.5% of the time, but cells 50 km away do 3.2% of the time.

**Part b, simulation on the bundle's 1 km grid.**

1. Confirmed fire = nominal- or high-confidence detections in the last 24 h. None: the route returns `no_confirmed_fire`.
2. The spread probability becomes a mean spread distance per day (a fire is a uniform 0 to 10 km from the cell edge; distance is taken as exponential).
3. Fire travels from the detected cells by minimum travel time. Rate is that mean, times a wind factor (elliptical fire shape, Anderson 1983, hour-by-hour forecast wind), a slope factor (`exp(0.078 x slope degrees)`, Alexandridis et al. 2008) and a fuel factor (Scott and Burgan 40 group; water, barren, urban and snow block it).
4. A cell reached after `t` hours has burned by horizon `T` with probability `exp(-t / T)`. Outlines enclose cells at 50% or more.

Response: `spread` (one polygon per horizon with `horizonHours`, `confidence`, `origin`, `headingDeg`, `rateKmh`, `headKm`, `areaKm2`), `cells` (arrival time and probability at 6, 12, 24 h), `drivers`, `meanSpreadKmPerDay`. Field names follow the web contract in `apps/web/README.md`.

## Limits

- **Model 1's target is a FIRMS detection,** not a confirmed wildfire. It includes agricultural and prescribed burns. No WFIGS labels.
- **Model 1 runs slightly high in the test period:** rows scored 0.4 to 0.6 burned 37% of the time.
- **Small table:** 8,071 rows. Retrain after each Open-Meteo run; boosting should pull ahead as it grows.
- **Wind's effect on spread is not learned.** The archive has no wind. On the 23,213 pairs with Open-Meteo weather, fire did go downwind more often (+2.7% odds per m/s, z = 1.7) but not significantly, so the coefficients are reported in `spread_metrics.json` and not used. Wind direction, slope and fuel factors are from the literature, and the fuel factors are rough assumed values.
- **Spread rates are low and unvalidated against perimeters.** A 60-detection fire gets about 0.4 km/day mean, 4 km at the head with 30 km/h wind. That is an average over every fire of that size, most of which do not run. No comparison with Mendeley or WFIGS perimeters yet.
- **Outlines are convex hulls,** so they smooth over barriers; the per-cell probabilities do not.
- **Live features differ from training:** RRFS forecast against archive reanalysis, 3DEP against LANDFIRE terrain, a rolling day against a calendar day.
- **The fire-history index ends when the archive was downloaded** (2026-11-14). After that, only the bundle's own 2 days of detections are added. Refresh the archive and retrain to keep 7, 30 and 365-day counts right.

## Running

From `apps/inference`, after `uv sync` (adds scikit-learn and joblib; `uv.lock` needs regenerating):

```bash
uv run python -m model.training.train_occurrence ../../data   # 20 s
uv run python -m model.training.train_spread ../../data       # 3 min
uv run uvicorn app:app --port 8000
uv run python -m pytest
```

- Artifacts: `data/models/occurrence.joblib`, `spread.joblib`, `fire_days.npy`, and `*_metrics.json` with every number above. Override the folder with `PYRO_MODEL_DIR`.
- The artifacts in `data/models` were trained with scikit-learn 1.9.1 on Python 3.13. If the installed version differs, the service logs a warning; retrain locally.
- 35 unit tests pass (`tests/test_models.py` plus the existing ones). The FastAPI module itself has not been run: FastAPI was not installed where the models were built.

## Next

1. Done: the orchestrator posts the bundle to `/predict` and `/spread` and merges `cells` and `spread` (`apps/orchestrator/README.md`, "Model output").
2. Check `bundle_features` against a real `GET /tiles` response.
3. Validate spread against perimeters (Mendeley, WFIGS) and tune the rate.
4. Add per-sensor likelihoods on top of model 1 once overpass masks and labels exist.
