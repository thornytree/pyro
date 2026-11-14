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
until Python inference is connected. Detections are real FIRMS points with lon/lat
GeoJSON coordinates. MODIS confidence is scaled from percent to 0–1; VIIRS keeps
its category in `confidenceCategory` and has null numeric confidence.

Errors use `{ "error": { "code": "...", "message": "..." } }`: malformed input
is 400, outside the coarse supported bounds is 422, unknown routes/states are 404,
and required-source failures are 502. Provider exceptions and credentials are not
returned. CORS permits the configured `WEB_ORIGIN`; non-browser tools work normally.

Local `apps/web/.env` is configured with `VITE_USE_MOCK=false` and the API URL.
Run `npm run dev:web` separately. Set the flag true to use offline mock data again.

Checks: `npm test --workspace @pyro/orchestrator`,
`npm run typecheck --workspace @pyro/orchestrator`,
`npm run build --workspace @pyro/orchestrator`.

See [source adapters](src/fan-out/README.md) for units, versions and grid semantics.
