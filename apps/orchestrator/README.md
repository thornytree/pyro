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
plus the full normalized `bundle`. With `INFERENCE_URL` configured, it POSTs this
bundle to Python `/predict` and validates the returned grid and forecast window.
Successful inference returns `status: "ready"`, populated `cells`, `updatedAt` and
`prediction` metadata. Without inference, or if it fails, `status: "observed"`
retains the source data with empty cells and null `updatedAt`. Detections are real FIRMS points with lon/lat
GeoJSON coordinates. MODIS confidence is scaled from percent to 0–1; VIIRS keeps
its category in `confidenceCategory` and has null numeric confidence.

Errors use `{ "error": { "code": "...", "message": "..." } }`: malformed input
is 400, outside the coarse supported bounds is 422, unknown routes/states are 404,
and a failure of the required weather source (Open-Meteo) is 502. That error includes the provider `source`,
safe `reason`, and `upstreamStatus` when available. A failure of FIRMS, Daymet, USGS 3DEP or LANDFIRE
does not fail the request: that field of `bundle` is null and the failure is listed in
`bundle.source_failures` with the same `source`, `reason`, `upstreamStatus` and message. Raw provider exceptions and
credentials are not returned. CORS permits the configured `WEB_ORIGIN`; non-browser tools work normally.

Local `apps/web/.env` is configured with `VITE_USE_MOCK=false` and the API URL.
Run `npm run dev:web` separately. Set the flag true to use offline mock data again.

Checks: `npm test --workspace @pyro/orchestrator`,
`npm run typecheck --workspace @pyro/orchestrator`,
`npm run build --workspace @pyro/orchestrator`.

See [source adapters](src/fan-out/README.md) for units, versions and grid semantics.

## Not built yet

- **Validated wildfire/spread predictions.** A trained experimental daily FIRMS-detection baseline is connected. It outputs sample-relative scores, not calibrated burn probabilities, spread direction/speed or future perimeters. See `apps/inference/README.md`.
- **State preview.** `GET /states/{fips}/preview` returns no tiles. It needs model output for many regions at once, which the request-driven design does not produce; see the statewide-preview caveat in `apps/web/README.md`.
- **Historical routes.** `GET /history/examples` lists available held-out samples. `GET /history/tiles?lat=&long=&date=YYYY-MM-DD` serves local archived cell-day scores through inference. `GET /history/states/{fips}/preview?date=YYYY-MM-DD` returns an empty preview. Missing samples return 404; unavailable archives return 503. Historical requests never call live providers.
- **Spread.** The web app accepts optional `spread` and `drivers` fields; the daily-detection baseline does not produce them.
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
`code` and `source`. The UI labels source-only results "Live observations" and model results
"Experimental daily fire score". Daymet dates remain explicit historical context. State
previews remain empty until model outputs exist. See `apps/web/README.md` for the
implemented live and historical contracts.

## Trained model connection

Local `.env` and `.env.example` now include `INFERENCE_URL=http://127.0.0.1:8000`
and `INFERENCE_TIMEOUT_MS=15000`. Start Python using the inference README, then
restart Express. For a remote model, change the URL. Leave `INFERENCE_URL` empty
for observations-only operation. `/health` probes the model service and reports
`inference: "ready"` (with `modelVersion`), `"unreachable"` or `"not_connected"`.
Each failed inference call is logged to the server console with its reason.

`src/inference/client.ts` posts the entire bundle, validates 0–1 scores, cell count,
row-major polygon geometry and the exact 24h window. `prediction` records version,
score kind, target, native resolution and uncertainty definition. A model timeout,
HTTP error or malformed output produces an observation response with
`inference: {status: "unavailable", message: "..."}` rather than losing detections.
Successful results use `inference.status: "ready"`; no configured URL uses
`not_configured`. This differs from a weather-provider failure, which remains 502.

The baseline requires at least 24 hourly forecasts, so with inference configured
the orchestrator fetches at least 24 hours even when `forecastHours` is lower.
Longer requests are scored for their first
24 hours only, as identified by `prediction.windowStart` and `windowEnd`. No
unsupported horizon is silently presented as a spread forecast. The historical
Daymet and LANDFIRE source bundles remain intact; the first model intentionally
uses only training-compatible weather, location and seasonal features.

## Historical replay

Requires the inference server and its local `training/compiled/test.csv.gz`. This
is sparse sampled coverage, not a complete fire archive. The map draws only
available native 10 km cells clipped to the 300-square-mile selection. `history`
metadata states the test split, retrospective weather, and full-cell FIRMS count.
No exact hotspot coordinates or perimeter geometry are fabricated. Cell properties
include `observedFire` and `observedDetectionCount`; `detections` and `perimeters`
are empty. Dates identify local-solar cell-days in the compiled archive; the
midnight timestamps are day identifiers, not exact acquisition/forecast times.
