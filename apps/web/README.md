# web

The website: interactive US heat map of current and predicted wildfires.

- Sends `lat`, `long` to `apps/orchestrator` (`src/fan-out/`). Base URL comes from `VITE_ORCHESTRATOR_URL`.
- Renders model output from `apps/inference/model/inference`, relayed by the orchestrator.

## Run

```bash
cp apps/web/.env.example apps/web/.env
npm install
npm run dev:web
```

Opens on port 5173. With `VITE_USE_MOCK=true` (the default in `.env.example`) the app renders generated tiles and does not call the orchestrator. Set it to `false` once the orchestrator serves `GET /tiles`.

`npm test --workspace @pyro/web` runs the unit tests; `npm run typecheck --workspace @pyro/web` type-checks.

## Interaction

0. **Location.** On load the browser asks for the user's location. If they allow it and the point is in a CONUS state, that state opens (unless they already opened one) and a blue dot marks them. "Use my location" asks again. The tile itself is not loaded, because loading a tile activates it.
1. **National view.** Hovering a state enlarges it (scaled 8% about its centre in Web Mercator, with a drop shadow; instant if the user prefers reduced motion). Clicking opens it, and so does zooming in one level past the national framing (the hovered state, or the one at the centre of the view).
2. **State view.** The map frames the state, dims everything else and loads a coarse preview: one square per 50 km tile, coloured by that tile's highest cell. Hovering outlines the tile a click would load. "Open the highest-risk tile" jumps to the hottest one. Clicking a neighbouring state switches to it; "All states", the "← US map" button on the map, Esc, or zooming out one level past the state's framing goes back. Thresholds are in `src/map/interaction.ts`.
3. **Tile view.** Clicking inside the open state calls `GET /tiles` as before and draws the full-resolution cells (about 1 km in the mock) and detections in place of that tile's preview square. In live mode, cells at 80% or more get a predicted spread: outlines for 6, 12 and 24 h and an arrow along the head fire, with the weather behind it in the panel. "Show on map" hides them. Terrain is drawn underneath: an elevation tint, multidirectional hillshade and contour lines (metres; majors labelled when the basemap has glyphs). Cells and preview squares are drawn lighter in this view so the relief shows through. Terrain is off when `VITE_TERRAIN_DEM_URL` is empty.

4. **Mode switch.** "Live / predictive" or "Historical" at the top of the panel. Historical adds a date field and day-step buttons (1 Nov 2000, the start of the FIRMS archive, to yesterday). Switching keeps the open state and tile and reloads them in the new mode, so one place can be compared across modes. A banner over the map always names the mode and day. The mode is in the URL (`?mode=historical&date=2021-08-20`) so a replay can be shared; a bad date falls back to the nearest valid one.

A fixed north arrow and a metric / imperial scale bar sit bottom right (top left on phones). The map cannot be rotated or tilted, so north is always up and the scale bar, measured at the centre of the view, stays accurate across it.

## Layout

- `src/config.ts`: reads and validates `VITE_*` variables. Nothing else touches `import.meta.env`.
- `src/api/types.ts`: the proposed tile contract (below).
- `src/api/client.ts`: orchestrator client. `src/api/mock.ts`: generated tiles with the same shape.
- `src/map/`: MapLibre map and layer styling. `terrain.ts` builds the DEM and contour sources and layers.
- `src/components/`: side panel, mode switch, legend and map HUD (compass, scale bar).
- `src/lib/`: map modes and URL state (`mode.ts`), spread ellipse geometry (`spread.ts`), scale bar maths (`scale.ts`), CONUS bounds pre-check, detection age helpers, state outlines (`states.ts`), geometry helpers (`geo.ts`), preview summary.

## Map modes

Decision 3 asks for live and historical views to be labelled differently. Both are built on mock data.

| | Live / predictive | Historical |
|---|---|---|
| Cells | Current burn probability | Model hindcast for that day |
| Detections | Last 24 h, aged from now | That day, aged from the end of the day |
| Overlay | Predicted spread around extreme-risk cells | Observed perimeters (western US, 2020 to 2024: Mendeley) |
| Routes | `GET /tiles`, `GET /states/{fips}/preview` | `GET /history/tiles`, `GET /history/states/{fips}/preview` (read-only) |
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

## Proposed API contract (not yet agreed with orchestrator / inference)

`GET {VITE_ORCHESTRATOR_URL}/tiles?lat=<number>&long=<number>` returns:

| Field | Type | Note |
|---|---|---|
| `tileId` | string | Shareable ID of the 50 km tile containing the point. Scheme is the orchestrator's choice; the web app treats it as opaque. |
| `status` | `"ready"` or `"queued"` | `queued`: tile was just activated, no model output yet. |
| `bounds` | `[west, south, east, north]` | Degrees. |
| `updatedAt` | ISO 8601 string or null | When the model output was produced. |
| `cells` | GeoJSON FeatureCollection of Polygons | Properties: `probability` (0 to 1), `uncertainty` (0 to 1). |
| `detections` | GeoJSON FeatureCollection of Points | Properties: `source`, `acquiredAt` (ISO 8601 UTC), `confidence` (0 to 1 or null), `frpMw` (number or null). |
| `spread` | GeoJSON FeatureCollection of Polygons, optional | Live only; empty when no cell is extreme. One feature per horizon. Properties: `horizonHours`, `confidence` (0 to 1), `origin` ([long, lat] where spread starts), `headingDeg` (clockwise from north), `rateKmh`, `headKm` (distance past `origin`). |
| `drivers` | object or null, optional | Live only. Weather behind the spread: `observedAt`, `temperatureC`, `relativeHumidityPct`, `windSpeedKmh` (10 m), `windFromDeg`. |
| `perimeters` | GeoJSON FeatureCollection of Polygons, optional | Historical only; empty where no perimeter data exists. Properties: `fireName`, `date` (YYYY-MM-DD), `source`, `areaKm2`. |

Geometry is GeoJSON in EPSG:4326 so the web app does not depend on the model grid's cell size or projection. A non-2xx status is shown as an error. The exact types are in `src/api/types.ts`.

Historical: `GET {VITE_ORCHESTRATOR_URL}/history/tiles?lat=&long=&date=YYYY-MM-DD` returns the same shape for that UTC day, with `perimeters` instead of `spread` and `drivers`. It is a separate route so the orchestrator can serve it read-only from the archive and never activate a tile.

`GET {VITE_ORCHESTRATOR_URL}/states/{fips}/preview` (two-digit state FIPS code, e.g. `06`) returns:

| Field | Type | Note |
|---|---|---|
| `stateId` | string | The FIPS code requested. |
| `updatedAt` | ISO 8601 string or null | Newest model output among the tiles. |
| `tiles` | GeoJSON FeatureCollection of Polygons | One feature per 50 km tile overlapping the state. Properties: `tileId` (same ID as `GET /tiles`), `peakProbability` (0 to 1, or null if the tile has no output yet), `meanUncertainty` (0 to 1 or null). |

Tiles with `null` values are drawn grey ("no model output yet"). The preview is read-only: it must not activate tiles. `GET /history/states/{fips}/preview?date=YYYY-MM-DD` returns the same shape for a past day.

## Caveats

- **Mock data is not real data.** With `VITE_USE_MOCK=true` every number on screen is generated (`src/api/mock.ts`). The panel shows a "mock data" badge. Do not demo it as model output.
- **A statewide preview conflicts with decision 2 as written.** Weather and the model run only for active tiles, so most preview squares would have no output (grey) on a real backend. Options: show FIRMS detection density for inactive tiles, run a cheap coarse model nationwide, or accept a mostly grey preview. Needs a decision before the orchestrator implements the endpoint.
- **State outlines are bundled** from `us-atlas` (Census Bureau 1:10m, about 110 kB). States are matched by FIPS code; Alaska, Hawaii and territories are left out (decision 7).
- **The mock preview is built in the browser** from the same generated tiles as `GET /tiles`, so its numbers match the full tile. Texas takes about 30 ms.
- **Mock tiles are not the real grid.** The mock snaps to a 0.5 degree lat/long grid with 10 x 10 cells and IDs like `mock-79_-223`. Real tiles are 50 km (decision 6); the working choice is EPSG:5070 with IDs like `r40c80` (`apps/orchestrator/src/fan-out/grid.ts`, not yet agreed). Switch the mock once it is.
- **The contract is unilateral.** `GET /tiles` and its response shape were written from the web side only. The orchestrator does not implement it yet; with `VITE_USE_MOCK=false` every click currently ends in an error.
- **The CONUS check is a bounding box** (`src/lib/conus.ts`). It accepts parts of Canada, Mexico and ocean. The orchestrator must do the real validation.
- **Basemap not verified end to end.** The overlay was tested against a blank local style because the build sandbox could not reach OpenFreeMap. Confirm the example style URL loads, and read OpenFreeMap's terms before a public launch.
- **Terrain not verified with the real basemap.** Checked in a headless browser against a blank style, so contour labels (which borrow the basemap's font and glyphs) were not seen. Confirm they render with OpenFreeMap. The elevation credit is in the panel footer, not MapLibre's attribution control; check the DEM provider's terms before a public launch.
- **Terrain is extra network load.** The tile view fetches DEM tiles (about 20 to 40 PNGs per view) and generates contours on a worker. It is only drawn in the tile view.
- **`.env` is required.** The app shows an error page if `VITE_MAP_STYLE_URL` is missing (or `VITE_ORCHESTRATOR_URL` when not mocking). There are no built-in defaults, by design.
- **MapLibre v6 worker.** MapLibre finds its web worker relative to its own module URL, which Vite rewrites. `src/map/MapView.tsx` imports the worker with `?url` and calls `setWorkerUrl`. Removing that breaks the map with "Worker failed to load".
- **Bundle size.** About 1.3 MB of JS (370 kB gzipped), nearly all MapLibre. Lazy-load the map if initial load time matters.
- **Payload size.** A mock tile is now 2,500 GeoJSON polygons, about 0.5 MB uncompressed, and renders without trouble. At 375 m (about 18,000 cells per tile) it would need a raster or a compact array format instead.
- **Spread is ahead of the model.** The model's first target is burn probability (decision 3); nothing on the inference side predicts spread yet. The outlines on screen come from a mock formula. Keep the "experimental" label until a real spread model, checked against the historical perimeters, replaces it.
- **Weather is coarser than the cells.** Weather is sampled every 10 km per active tile (`apps/orchestrator/src/fan-out/meteo.ts`), so 1 km cells and single-digit-mile spread rely on terrain and fuels (LANDFIRE, 30 m) for detail below that. Wind direction near ridges and canyons can differ a lot from a 10 km sample.
- **Wind adjustment is a constant.** Midflame wind is taken as 0.4 x the 10 m wind everywhere. The real factor depends on canopy cover and should come from LANDFIRE.
- **Historical perimeters are thin.** The Mendeley set covers 737 western fires from 2020 to 2024. Elsewhere, and on other dates, the panel says no perimeter was mapped. WFIGS (decision 8) could widen it once verified.
- **No component or end-to-end tests.** Unit tests cover the client, mock, config, geometry, state outlines, click handling, map modes and spread geometry. The hover, state, tile and mode-switch flows were checked by hand in a headless browser against a blank basemap, on desktop and phone sizes.
- **Detection ages are computed when a tile loads** and do not tick while the page stays open.

## Open questions

- Historical mode: are model hindcasts wanted (they need a trained model), or archived detections and perimeters only? The `/history` routes need agreement with the orchestrator, and the archive needs to be loadable per tile and day.
- Spread: who builds the spread model, and does it run per active tile with the burn-probability model? Which horizons? What does `confidence` mean exactly?
- Agree the contract above with the orchestrator and inference owners, including the error body and the status code for a point outside CONUS.
- What `uncertainty` is (posterior standard deviation, interval width) and how it is scaled to 0 to 1.
- Queued tiles: the panel shows a "Check again" button. Polling or push is undecided.
- National FIRMS detection layer shown before any tile is selected (decision 7 polls FIRMS nationwide); it needs its own endpoint.
- Loading a tile from a shared tile ID in the URL.
- Attribution: the panel credits NASA FIRMS, Open-Meteo and LANDFIRE. Add CC BY 4.0 credit for the Mendeley dataset if it is used, and NIFC / WFIGS if perimeters are shown.
