# Orchestrator

## Run

1. Fill in `FIRMS_MAP_KEY` and `EARTHDATA_TOKEN` in `apps/orchestrator/.env`.
2. Set `DAYMET_START_DATE` and `DAYMET_END_DATE` to an available historical range
   of at most 366 days. The template's July 2020 dates are example historical context.
3. From the repository root: `npm run dev:orchestrator`.
4. Open `http://localhost:3001/health` for startup status without fetching providers.

The server automatically loads its own `.env` in development and after compilation.
Existing process environment values take precedence. Missing required settings or
invalid port, date, origin, forecast horizon or LANDFIRE version prevent startup.
Restart the process after changing `.env`. Never put source credentials in web/VITE
variables. `.env` is ignored by Git; `.env.example` contains no tokens.

## Requests

```text
GET /tiles?lat=34.05&long=-118.25
GET /tiles?lat=34.05&long=-118.25&forecastHours=12&daymetStart=2020-07-01&daymetEnd=2020-07-03
GET /states/06/preview
```

The tile route matches the web client input. Coordinates must be finite, within
valid geographic ranges and the web client's coarse CONUS bounds. This bounding
check is not a national-border or land-mask test; sources may still lack coverage.
Optional forecast hours (1–72) and historical dates override server defaults.
State preview validates a CONUS state FIPS code and currently returns an empty
FeatureCollection: there are no statewide model results yet, and it starts no jobs.

`/tiles` waits for all five data providers, then returns the web GeoJSON envelope
plus the full normalized `bundle`. `status: "observed"` means observations were
retrieved, not a forecast or queued task. `cells` is empty and `updatedAt` is null
unless Python inference is connected (see "Model output"). Detections are real FIRMS points with lon/lat
GeoJSON coordinates. MODIS confidence is scaled from percent to 0–1; VIIRS keeps
its category in `confidenceCategory` and has null numeric confidence.

Errors use `{ "error": { "code": "...", "message": "..." } }`: malformed input
is 400, outside the coarse supported bounds is 422, unknown routes/states are 404,
and required-source failures are 502. Source failures include a provider `source`,
safe `reason`, and `upstreamStatus` when available. Raw provider exceptions and
credentials are not returned. CORS permits the configured `WEB_ORIGIN`; non-browser tools work normally.

Local `apps/web/.env` is configured with `VITE_USE_MOCK=false` and the API URL.
Run `npm run dev:web` separately. Set the flag true to use offline mock data again.

Checks: `npm test --workspace @pyro/orchestrator`,
`npm run typecheck --workspace @pyro/orchestrator`,
`npm run build --workspace @pyro/orchestrator`.

See [source adapters](src/fan-out/README.md) for units, versions and grid semantics.

## Model output

Set `INFERENCE_URL` (see `.env.example`) and start `apps/inference` (`uv run uvicorn app:app --port 8000`).
After fan-out, `/tiles` posts the bundle, without Daymet, to `POST /predict` and `POST /spread` at the same time
(`src/inference.ts`) and merges the answers (`src/tile-response.ts`):

| Outcome | Response |
|---|---|
| Both models answer | `status: "ready"`, `updatedAt`, `cells` (`probability`, `uncertainty`, `riskScore`, `detections`), `spread`, `drivers`, `model` |
| No confirmed fire in the region | `ready` with an empty `spread`; `model.spread.status` is `no_confirmed_fire` |
| Only `/spread` fails | `ready` with an empty `spread`; `model.spread.status` is `unavailable` |
| `/predict` fails, times out (`INFERENCE_TIMEOUT_MS`) or returns something malformed | `status: "observed"` as before, plus `inference: { status: "failed", reason, message }` |
| `INFERENCE_URL` unset | `observed`, `inference: { status: "not_configured" }` |

Model failures never fail the request: detections and the bundle are always returned. `reason` is one of
`unreachable`, `timeout`, `models_missing` (503: artifacts not trained), `bundle_rejected` (422), `bad_response`, `service_error`.
`GET /health` reports `inference` as `connected`, `models_missing`, `unreachable` or `not_connected` (no URL).

`model` carries `version`, `predictionDate`, `baseRate`, `fireHistoryThrough` and a `spread` summary.
`probability` is calibrated to the real fire rate (about 1.4% of cell-days), so it stays in the low percents;
`riskScore` is the uncalibrated 0 to 1 score the web map colours by. See `docs/handover/models.md`.

Not yet checked against a real fan-out bundle: tests use the fixture bundle and stubbed model responses.

## Not built yet

- **State preview.** `GET /states/{fips}/preview` returns no tiles. It needs model output for many regions at once, which the request-driven design does not produce; see the statewide-preview caveat in `apps/web/README.md`.
- **Historical routes.** `GET /history/tiles` and `GET /history/states/{fips}/preview` are not implemented. The frontend disables historical replay with the real backend and keeps it available with mocks. Historical URL parameters normalize to live mode; live Daymet context is not a replay.
- **Spread burn-probability cells.** `/spread` also returns per-cell arrival times and burn probabilities; the orchestrator drops them because the web app only draws the outlines.
- **Scheduled ingestion.** The 50 km grid and scheduler in `src/fan-out/` are not started. Whether to keep request-driven fetching (every click fetches five providers) or move to the scheduled design of decisions 2 and 11 needs a team decision; see `docs/handover/decisions.md`.

## Frontend contract alignment

No live route or required request parameter changed. A state selection loads only
`/states/{fips}/preview`; a point selection then invokes `/tiles?lat=&long=` and
its five-provider `fanOutEntry`. The separate `requestTileAt`/scheduler path is not
used by the browser. The response's `bundle` is required for `status: "observed"`.
The frontend type-references `dataBundle`, verifies the requested location and
cross-provider regional extents/dimensions, and uses response bounds for map framing.
The source-data download contains this same bundle. Defaults for forecast horizon,
Daymet dates and LANDFIRE version remain server-side; no frontend token is required.

The API client displays safe backend diagnostic messages and preserves error
`code` and `source`. The UI labels real results "Live observations", with no model
probabilities, and shows Daymet dates explicitly as historical context. State
previews remain empty until model outputs exist. See `apps/web/README.md` for the
implemented contract and the future historical/model fields.
