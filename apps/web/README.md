# web

The website: interactive US heat map of current and predicted wildfires.

- Sends `lat`, `long` to `apps/orchestrator` (`GET /tiles`). Base URL comes from `VITE_ORCHESTRATOR_URL`.
- Will render model output from `apps/inference`, relayed by the orchestrator. Until that exists:
  - **Against the orchestrator** (`VITE_USE_MOCK=false`): a tile shows real FIRMS detections and, when the Python baseline responds, a daily detection-score heat map. Model failures retain source observations. Opening a state draws a heat map of the whole state from `GET /states/{fips}/heatmap`. Historical replay serves sparse held-out cell-days from the Python archive. Use “Open archived fire-detection example” to open an available date/location. The panel shows source data for the clicked region and offers its JSON download.
  - **Mock** (`VITE_USE_MOCK=true`): every feature works on generated data, including cells, spread and historical mode.

## Run

```bash
cp apps/web/.env.example apps/web/.env
npm install
npm run dev:web
```

Opens on port 5173. With `VITE_USE_MOCK=true` the app renders generated tiles without the orchestrator. The local `.env` and example now use `false` to call Express. Configure the orchestrator credentials and start it before clicking a region.

`npm test --workspace @pyro/web` runs the unit tests; `npm run typecheck --workspace @pyro/web` type-checks.

## Interaction

0. **Location.** On load the browser asks for the user's location. If they allow it and the point is in a CONUS state, that state opens (unless they already opened one) and a blue dot marks them. "Use my location" asks again. The tile itself is not loaded, because loading a tile activates it.
1. **National view.** Hovering a state enlarges it (scaled 8% about its centre in Web Mercator, with a drop shadow; instant if the user prefers reduced motion). Clicking opens it, and so does zooming in one level past the national framing (the hovered state, or the one at the centre of the view).
2. **State view.** The map frames the state, dims everything else and draws one heat map over the whole state, with every satellite detection in it. The scores arrive as a coarse grid and are interpolated in the browser into a single image clipped to the state outline (`src/lib/heatmap.ts`), so there are no tiles to wait for. The panel shows the peak score, the share of the state at 50 or more, the grid's resolution and "Open the highest-risk area". Clicking a neighbouring state switches to it; "All states", the "← US map" button on the map, Esc, or zooming out one level past the state's framing goes back. Thresholds are in `src/map/interaction.ts`.
3. **Tile view.** Clicking inside the open state calls `GET /tiles` as before and draws the region's full-resolution cells (about 1 km in the mock) and detections over the statewide heat map. In live mode, cells at 80% or more get a predicted spread: outlines for 6, 12 and 24 h and an arrow along the head fire, with the weather behind it in the panel. "Show on map" hides them. Terrain is drawn underneath: an elevation tint, multidirectional hillshade and contour lines (metres; majors labelled when the basemap has glyphs). Cells are drawn lighter in this view so the relief shows through. Terrain is off when `VITE_TERRAIN_DEM_URL` is empty.

4. **View switch.** The control at the top of the map switches between "Heat map" (the model overlay: statewide heat map and a loaded region's cells) and the view beneath it: "Terrain" (elevation tint, hillshade and contours) and "Satellite" (aerial imagery from `VITE_SATELLITE_TILES_URL`). Detections, spread outlines and perimeters stay visible in every view. A base view that is not configured is left out; with neither, "Map only" shows the plain basemap.

5. **Mode switch.** "Live / predictive" or "Historical" at the top of the panel. Historical adds a date field and day-step buttons (1 Nov 2000, the start of the FIRMS archive, to yesterday). Switching keeps the open state and tile and reloads them in the new mode, so one place can be compared across modes. A banner over the map always names the mode and day. The mode is in the URL (`?mode=historical&date=2021-08-20`) so a replay can be shared; a bad date falls back to the nearest valid one.

A fixed north arrow and a metric / imperial scale bar sit bottom right (top left on phones). The map cannot be rotated or tilted, so north is always up and the scale bar, measured at the centre of the view, stays accurate across it.

## Layout

- `src/config.ts`: reads and validates `VITE_*` variables. Nothing else touches `import.meta.env`.
- `src/api/types.ts`: the proposed tile contract (below).
- `src/api/client.ts`: orchestrator client. `src/api/mock.ts`: generated tiles with the same shape.
- `src/lib/heatmap.ts`: renders the statewide score grid to an image and summarizes it.
- `src/map/`: MapLibre map and layer styling. `terrain.ts` builds the DEM and contour sources and layers.
- `src/components/`: side panel, mode switch, legend and map HUD (compass, scale bar).
- `src/lib/`: map modes and URL state (`mode.ts`), spread ellipse geometry (`spread.ts`), scale bar maths (`scale.ts`), CONUS bounds pre-check, detection age helpers, state outlines (`states.ts`), geometry helpers (`geo.ts`).

## Map modes

Decision 3 asks for live and historical views to be labelled differently. Both are built on mock data.

| | Live / predictive | Historical |
|---|---|---|
| Cells | Current burn probability | Model hindcast for that day |
| Detections | Last 24 h, aged from now | That day, aged from the end of the day |
| Overlay | Predicted spread around extreme-risk cells | Observed perimeters (western US, 2020 to 2024: Mendeley) |
| Routes | `GET /tiles`, `GET /states/{fips}/heatmap` | `GET /history/tiles` (read-only). No statewide heat map against the real archive; the mock generates one. |
| Activates tiles | Yes (decision 2) | Never |

Mode logic (URL parsing, date range, the reference time detections are aged from) is in `src/lib/mode.ts`; the switch is `src/components/ModeSwitch.tsx`.

## Resolution and predicted spread

- **Cells.** The mock tile is 50 x 50 cells of 0.01 degrees, about 1.1 km (0.7 mi) north-south, up from 10 x 10. The contract does not fix a cell size, so the real one is still the model's choice (decision 6).
- **Spread (experimental).** Where a cell reaches 80% (`EXTREME_PROBABILITY` in `src/lib/spread.ts`), the live tile carries spread outlines for 6, 12 and 24 h. The fire is taken to cover the extreme cells already; spread starts at their downwind edge. The shape is the standard wind-driven ellipse: length-to-breadth ratio from midflame wind (Anderson 1983), with midflame wind taken as 0.4 x the 10 m wind. The rate of spread, and so the reach, comes from wind and humidity. The panel shows heading, rate, reach in miles and km per horizon, and the weather used.
- **Mock only.** The rate formula (`mockRateKmh`) and the 9-mile cap on reach (`MAX_HEAD_KM`) are placeholders in `src/api/mock.ts` to make the UI testable. Real outlines must come from the inference API, which does not predict spread yet; decision 3 limits spread to a proof of concept.

## Decided here

- **Map library: MapLibre GL JS.** Open source, no API token, draws GeoJSON cells on the GPU. The basemap is any MapLibre style URL, set in `VITE_MAP_STYLE_URL`. The example value is OpenFreeMap (no key); check its terms before a public launch.
- **Terrain: any raster DEM, contours generated in the browser.** `VITE_TERRAIN_DEM_URL` takes Terrarium or Mapbox Terrain-RGB tiles. The example is AWS Terrain Tiles (public, no key). Contours come from `maplibre-contour`, which builds them in a web worker from the same DEM tiles the hillshade uses, so there is no contour tile server. Hillshade and elevation tint are MapLibre's own `hillshade` and `color-relief` layers.
- **Detection age and confidence (first pass).** Detections are dots that fade over 24 hours; the panel shows the age of the newest one. Cell colour is probability and cell opacity drops as uncertainty rises.

## API contract (Express observations; Python inference pending)

`GET {VITE_ORCHESTRATOR_URL}/tiles?lat=<number>&long=<number>` returns:

| Field | Type | Note |
|---|---|---|
| `tileId` | string | Opaque region ID; live requests cover 300 square miles centered on the point. |
| `status` | `"observed"`, `"ready"` or `"queued"` | Express returns `ready` after validated Python inference, otherwise `observed` source data. No scheduler task is implied. |
| `bounds` | `[west, south, east, north]` | Degrees. |
| `updatedAt` | ISO 8601 string or null | When the model output was produced. |
| `cells` | GeoJSON FeatureCollection of Polygons | Properties: `probability` (0 to 1), `uncertainty` (0 to 1). |
| `detections` | GeoJSON FeatureCollection of Points | Properties: `source`, `acquiredAt` (ISO 8601 UTC), `confidence` (0 to 1 or null), `frpMw` (number or null). |
| `prediction` | object, optional | Model version, `scoreKind`, target, exact forecast window, horizon, native resolution and uncertainty definition. The current model uses sample-relative detection scores. |
| `inference` | object, optional | `status`: `ready`, `not_configured` or `unavailable`, plus a safe fallback message when unavailable. |
| `spread` | GeoJSON FeatureCollection of Polygons, optional | Live only; empty when no cell is extreme. One feature per horizon. Properties: `horizonHours`, `confidence` (0 to 1), `origin` ([long, lat] where spread starts), `headingDeg` (clockwise from north), `rateKmh`, `headKm` (distance past `origin`). |
| `drivers` | object or null, optional | Live only. Weather behind the spread: `observedAt`, `temperatureC`, `relativeHumidityPct`, `windSpeedKmh` (10 m), `windFromDeg`. |
| `bundle` | `dataBundle`, present for real responses | Full normalized source data for the selected point and 300-square-mile region. Type-only reference to the orchestrator schema; not generated mock data. |
| `perimeters` | GeoJSON FeatureCollection of Polygons, optional | Historical only; empty where no perimeter data exists. Properties: `fireName`, `date` (YYYY-MM-DD), `source`, `areaKm2`. |

Geometry is GeoJSON in EPSG:4326 so the web app does not depend on the model grid's cell size or projection. A non-2xx status is shown as an error. The exact types are in `src/api/types.ts`.

Implemented historical route: `GET {VITE_ORCHESTRATOR_URL}/history/tiles?lat=&long=&date=YYYY-MM-DD` would return the same shape for that UTC day, with `perimeters` instead of `spread` and `drivers`. It is a separate route so the orchestrator can serve it read-only from the archive and never activate a tile.

`GET {VITE_ORCHESTRATOR_URL}/states/{fips}/heatmap` (two-digit state FIPS code, e.g. `06`) returns:

| Field | Type | Note |
|---|---|---|
| `stateId` | string | The FIPS code requested. |
| `status` | `"ready"` or `"observed"` | `observed`: detections only, `grid` is null. |
| `bounds` | `[west, south, east, north]` | The grid's extent: the state's bounding box. |
| `updatedAt` | ISO 8601 string or null | When the scores were produced. |
| `grid` | object or null | `rows`, `columns`, `spacingKm` and two row-major arrays (north to south, west to east), `probability` and `uncertainty`, 0 to 1 or `null` where nothing was scored. |
| `detections` | GeoJSON FeatureCollection of Points | FIRMS detections inside the state; same properties as a tile's. |
| `prediction`, `inference` | objects, optional | As for a tile. |
| `sourceFailures` | array, optional | A failed FIRMS fetch: `source` and a safe `message`. |

The grid is compact on purpose: a few hundred numbers instead of thousands of polygons. The browser interpolates between points and clips to the state outline. Opening a state never triggers the regional five-provider fetch. In historical mode the client makes no statewide request, because the real archive is sparse samples; the panel says so.

## Caveats

- **Mock data is not real data.** With `VITE_USE_MOCK=true` every number on screen is generated (`src/api/mock.ts`). The panel shows a "mock data" badge. Do not demo it as model output.
- **The statewide heat map is an overview.** The orchestrator scores a few hundred points per state (about 47 km apart in California, 10 km in the smallest states) and the browser interpolates between them. Local detail comes from clicking a region. See `apps/orchestrator/README.md` for the point budget and cache.
- **State outlines are bundled** from `us-atlas` (Census Bureau 1:10m, about 110 kB). States are matched by FIPS code; Alaska, Hawaii and territories are left out (decision 7).
- **The mock heat map is built in the browser** from the same generated tiles as `GET /tiles` (the mean of each 5 x 5 block of cells), so it matches a clicked region. Each mock tile has its own hotspot, which is why the mock heat map looks blocky. A test keeps Texas, the largest, under 400 ms.
- **Mock tiles are not the real grid.** The mock snaps to a 0.5 degree lat/long grid with 50 x 50 cells (about 1 km) and IDs like `mock-79_-223`. Live requests use centered 300-square-mile regions, as requested for the current prototype.
- **First model is experimental.** Express relays a trained daily FIRMS-detection baseline. Its sample-relative scores are not calibrated burn probabilities; native model cells are 10 km even though the display grid is finer. The UI labels the score accordingly.
- **Historical coverage is sparse.** Real replay uses held-out sampled cell-days and retrospective weather. It returns scores and full-cell detection counts, with empty exact-hotspot and perimeter layers. Missing area/date samples return a clear error. Spread remains mock-only.
- **The CONUS check is a bounding box** (`src/lib/conus.ts`). It accepts parts of Canada, Mexico and ocean. The orchestrator must do the real validation.
- **Basemap not verified end to end.** The overlay was tested against a blank local style because the build sandbox could not reach OpenFreeMap. Confirm the example style URL loads, and read OpenFreeMap's terms before a public launch.
- **Terrain not verified with the real basemap.** Checked in a headless browser against a blank style, so contour labels (which borrow the basemap's font and glyphs) were not seen. Confirm they render with OpenFreeMap. The elevation credit is in the panel footer, not MapLibre's attribution control; check the DEM provider's terms before a public launch.
- **Terrain is extra network load.** It fetches DEM tiles (about 20 to 40 PNGs per view) and generates contours on a worker. It is only drawn in the terrain view and under a loaded region.
- **Satellite imagery not verified end to end.** The example URL is the USGS National Map imagery service; the build sandbox could not reach it. Confirm it loads and read its terms before a public launch.
- **`.env` is required.** The app shows an error page if `VITE_MAP_STYLE_URL` is missing (or `VITE_ORCHESTRATOR_URL` when not mocking). There are no built-in defaults, by design.
- **MapLibre v6 worker.** MapLibre finds its web worker relative to its own module URL, which Vite rewrites. `src/map/MapView.tsx` imports the worker with `?url` and calls `setWorkerUrl`. Removing that breaks the map with "Worker failed to load".
- **Bundle size.** The map is loaded lazily: the first chunk is about 385 kB of JS (125 kB gzipped) and paints the panel; MapLibre follows in its own 1.1 MB chunk (310 kB gzipped).
- **Payload size.** A mock tile is now 2,500 GeoJSON polygons, about 0.5 MB uncompressed, and renders without trouble. At 375 m (about 18,000 cells per tile) it would need a raster or a compact array format instead.
- **Spread is ahead of the model.** The model's first target is burn probability (decision 3); nothing on the inference side predicts spread yet. The outlines on screen come from a mock formula. Keep the "experimental" label until a real spread model, checked against the historical perimeters, replaces it.
- **Weather is coarser than the cells.** Weather is sampled every 10 km per active tile (`apps/orchestrator/src/fan-out/meteo.ts`), so 1 km cells and single-digit-mile spread rely on terrain and fuels (LANDFIRE, 30 m) for detail below that. Wind direction near ridges and canyons can differ a lot from a 10 km sample.
- **Wind adjustment is a constant.** Midflame wind is taken as 0.4 x the 10 m wind everywhere. The real factor depends on canopy cover and should come from LANDFIRE.
- **Historical perimeters are thin.** The Mendeley set covers 737 western fires from 2020 to 2024. Elsewhere, and on other dates, the panel says no perimeter was mapped. WFIGS (decision 8) could widen it once verified.
- **HTTP contract tests are included.** Tests cover the real API client against a local Express server with upstream retrieval stubbed, plus the client, mock, config, geometry, state outlines, click handling, map modes and spread geometry. This is not a full browser end-to-end test. The hover, state, tile and mode-switch flows were checked by hand in a headless browser against a blank basemap, on desktop and phone sizes.
- **Detection ages are computed when a tile loads** and do not tick while the page stays open.

## Open questions

- Historical mode: are model hindcasts wanted (they need a trained model), or archived detections and perimeters only? The `/history` routes need agreement with the orchestrator, and the archive needs to be loadable per tile and day.
- Spread: who builds the spread model, and does it run per active tile with the burn-probability model? Which horizons? What does `confidence` mean exactly?
- Agree future inference and historical additions; the implemented live observation contract is documented above and in the orchestrator README.
- What `uncertainty` is (posterior standard deviation, interval width) and how it is scaled to 0 to 1.
- Queued tiles: the panel shows a "Check again" button. Polling or push is undecided.
- National FIRMS detection layer shown before any tile is selected (decision 7 polls FIRMS nationwide); it needs its own endpoint.
- Loading a tile from a shared tile ID in the URL.
- Attribution: the panel credits NASA FIRMS, Open-Meteo and LANDFIRE. Add CC BY 4.0 credit for the Mendeley dataset if it is used, and NIFC / WFIGS if perimeters are shown.

The Express response also includes `bundle` for inspection/inference integration;
the web map consumes only the GeoJSON envelope. For observed results, categorical
VIIRS confidence is preserved in `confidenceCategory`; numeric confidence is null.
See [`apps/orchestrator/README.md`](../orchestrator/README.md) for startup and query
options. The health endpoint reports configuration readiness, not proof that every
upstream credential or requested historical date is authorized/available.

## Selected-area integration contract

The route is unchanged: first open a state, then click inside it to send that exact
point as `lat` and `long` to `GET /tiles`. Opening a state requests only its heat map
(cached per state on the server); it does not run the regional five-provider fetch. Live requests call
Express's request-driven `fanOutEntry`, not the fixed-50-km `requestTileAt` helper.
The selected point is the centre of a 300-square-mile region, not the whole state
or the mock's snapped 0.5-degree tile. The map frames the returned `bounds`.

For observed live results, `bundle` is now part of the typed frontend contract.
`src/api/types.ts` imports the orchestrator's `dataBundle` type only; no server code
or credentials are included in the browser bundle. Client validation checks that
the selected point matches `bundle.location`, that response bounds contain that
point, and that weather, terrain, vegetation and historical-context output grids
share the same extent and dimensions. Model scientific-input validation remains
server-side; the browser does not certify forecast accuracy.

The panel shows the requested coordinates, point weather, terrain elevation, grid
size, fuel version and Daymet historical date range. "Download source data" saves
the complete normalized bundle for the region. The historical date range is context
inside a live request, not the historical replay mode. The frontend currently uses
`DEFAULT_FORECAST_HOURS`, `DAYMET_START_DATE`, `DAYMET_END_DATE` and `LANDFIRE_VERSION`
from the backend environment; there are no new mandatory query parameters or UI
settings. Prediction cells are present only when the model returns a validated response.

Error responses retain `{error: {code, message, source?, reason?, upstreamStatus?}}`.
The API client now shows the safe backend message and preserves its code/source,
instead of displaying only an HTTP number. State heat-map responses must match the
requested state FIPS code and grid dimensions. A previous point/mode request is still aborted when a
new selection is made, so older responses do not replace the active selection.

Historical replay is connected to the real local archive. Spread simulations remain available in **mock mode**. Historical shared URLs preserve their date and use the archive routes; current detections are never presented as past observations.

Vite uses `strictPort` on 5173 so it does not silently switch ports and break the
backend's `WEB_ORIGIN=http://localhost:5173` CORS setting. Set `VITE_USE_MOCK=false`
and `VITE_ORCHESTRATOR_URL=http://localhost:3001` for the real API. Tokens belong
only in `apps/orchestrator/.env`.

Validation includes a real local HTTP contract test using the frontend API client,
Express route parsing/serialization and a stubbed upstream fan-out. It checks two
selected locations, the 300-square-mile extent, GeoJSON coordinate order, full
bundle acceptance, the state heat-map route, and rejected out-of-area points. All API calls
to external providers in this test are stubbed.

Latest live-provider smoke check: the real client reached Express and received a
source-specific Open-Meteo connection-timeout error. A successful all-provider
response could not be re-verified during this contract audit; the local HTTP
contract tests pass with provider retrieval stubbed. This is separate from map
rendering, which was not re-tested in a browser in this audit.

## Daily detection baseline

The first connected model returns `prediction.scoreKind = "sample_relative"` and
`nativeResolutionKm = 10`. The map's legacy `probability` property contains the
mean score of five bootstrap members, not a calibrated wildfire probability.
The legend/panel use "daily fire-detection score" and identify experimental 24h
output. Finer display polygons repeat native 10 km scores. Opacity uses twice the
ensemble score standard deviation; the UI describes it as model disagreement.
No spread arrows, speed, future perimeter or threshold-based spread statement is
fabricated for this model. Mock spread behavior is retained separately.

`status: "ready"` includes `prediction` and populated cells after backend validation.
When inference is unavailable, the existing `observed` view remains with source
data and a model-unavailable note. The selected-area bundle is still checked for
real live responses, including those marked ready. Historical mode uses sparse archived samples
against the real backend. See `apps/inference/README.md` and its training report
for held-out metrics and limitations.

## Local archive demo

Click **Open archived fire-detection example**. The app opens a held-out test
cell-day, selects its state and date, and displays real model scores computed from
archived weather. Each further click opens the next held-out fire cell-day in date
order, oldest first, and wraps after the last. `GET /history/examples` supplies them; `/history/tiles`
returns native-cell polygons plus `history` provenance. Blank regions mean no
sample, not no fire. Counts describe full native cells even at clipped edges.
The `date` is the archive's local-solar day. This is retrospective reconstruction,
not a forecast issued historically or a validated spread prediction. Observed
perimeters and exact hotspot positions are not present in this local archive.
