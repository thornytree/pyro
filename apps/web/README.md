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
3. **Tile view.** Clicking inside the open state calls `GET /tiles` as before and draws the full-resolution cells and detections in place of that tile's preview square. Terrain is drawn underneath: an elevation tint, multidirectional hillshade and contour lines (metres; majors labelled when the basemap has glyphs). Cells and preview squares are drawn lighter in this view so the relief shows through. Terrain is off when `VITE_TERRAIN_DEM_URL` is empty.

All of the above is the **live / predictive** map. There is no historical mode yet; see "Not built yet" below.

A fixed north arrow and a metric / imperial scale bar sit bottom right (top left on phones). The map cannot be rotated or tilted, so north is always up and the scale bar, measured at the centre of the view, stays accurate across it.

## Layout

- `src/config.ts`: reads and validates `VITE_*` variables. Nothing else touches `import.meta.env`.
- `src/api/types.ts`: the proposed tile contract (below).
- `src/api/client.ts`: orchestrator client. `src/api/mock.ts`: generated tiles with the same shape.
- `src/map/`: MapLibre map and layer styling. `terrain.ts` builds the DEM and contour sources and layers.
- `src/components/`: side panel, legend and map HUD (compass, scale bar).
- `src/lib/`: scale bar maths (`scale.ts`), CONUS bounds pre-check, detection age helpers, state outlines (`states.ts`), geometry helpers (`geo.ts`), preview summary.

## Not built yet: historical / live map modes

The map only has one model: current model output plus the last 24 hours of detections. The plan is two modes with a visible switch between them, labelled differently as decision 3 requires:

| Mode | Shows | Data |
|---|---|---|
| **Live / predictive** (built, mock only) | Current burn probability per cell, recent detections. | `GET /tiles`, `GET /states/{fips}/preview`. |
| **Historical** (not built) | What happened on a chosen past date: archived detections, and where available actual fire perimeters and the model's output for that date (hindcast). | Harmonized FIRMS archive (Nov 2000 to now, `data/firms_harmonized`), Mendeley daily perimeters (western US, 2020 to 2024), model runs on archive dates. No endpoint yet. |

What the switch needs:

- **UI.** A mode toggle in the panel, plus a date picker or time slider in historical mode. The mode and date should go in the URL so a view can be shared. The "mock data" badge and the legend must say which mode is shown so a replay is not read as a current forecast.
- **State.** `App.tsx` keeps one `selection` and one `preview`; both need to be keyed by mode (and date), and switching mode must abort in-flight requests the same way switching state does.
- **Contract.** Historical requests must not activate tiles (decision 2), so they need a separate read-only route or a `date` parameter that the orchestrator treats as read-only, for example `GET /tiles?lat=&long=&date=YYYY-MM-DD`. Not proposed to the orchestrator yet.
- **Mock.** `src/api/mock.ts` needs a date-aware generator, or a small sample cut from the harmonized archive.
- **Layers.** Perimeters are a new polygon layer; spread direction and rate (decision 3 proof of concept) a later one.

Open: what "historical model" means in practice (raw observations only, or model hindcasts, which need the model trained first), the date range offered, and the time step (daily is the natural fit for the perimeter data).

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

Geometry is GeoJSON in EPSG:4326 so the web app does not depend on the model grid's cell size or projection. A non-2xx status is shown as an error. The exact types are in `src/api/types.ts`.

`GET {VITE_ORCHESTRATOR_URL}/states/{fips}/preview` (two-digit state FIPS code, e.g. `06`) returns:

| Field | Type | Note |
|---|---|---|
| `stateId` | string | The FIPS code requested. |
| `updatedAt` | ISO 8601 string or null | Newest model output among the tiles. |
| `tiles` | GeoJSON FeatureCollection of Polygons | One feature per 50 km tile overlapping the state. Properties: `tileId` (same ID as `GET /tiles`), `peakProbability` (0 to 1, or null if the tile has no output yet), `meanUncertainty` (0 to 1 or null). |

Tiles with `null` values are drawn grey ("no model output yet"). The preview is read-only: it must not activate tiles.

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
- **Payload size is untested.** One tile as GeoJSON polygons is fine at 100 cells; at a fine cell size (for example 375 m, about 18,000 cells per tile) it may need a raster or a compact array format instead.
- **No component or end-to-end tests.** Unit tests cover the client, mock, config, geometry, state outlines and click handling. The hover, state and tile flow was checked by hand in a headless browser against a blank basemap.
- **Detection ages are computed when a tile loads** and do not tick while the page stays open.

## Open questions

- Historical / live mode switch: scope, data and contract (see "Not built yet" above).
- Agree the contract above with the orchestrator and inference owners, including the error body and the status code for a point outside CONUS.
- What `uncertainty` is (posterior standard deviation, interval width) and how it is scaled to 0 to 1.
- Queued tiles: the panel shows a "Check again" button. Polling or push is undecided.
- National FIRMS detection layer shown before any tile is selected (decision 7 polls FIRMS nationwide); it needs its own endpoint.
- Loading a tile from a shared tile ID in the URL.
- Attribution: the panel credits NASA FIRMS, Open-Meteo and LANDFIRE. Add CC BY 4.0 credit for the Mendeley dataset if it is used, and NIFC / WFIGS if perimeters are shown.
