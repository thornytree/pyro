# Front end: work so far

Last updated: 2026-11-14. Branch: `front-end-mockup` (merged to `main` in `802f6d9`).

The map site lives in `apps/web` (React, Vite, MapLibre GL JS). It runs on generated mock data. No real model output is wired in yet. Setup, the API contract and a full list of caveats are in [`apps/web/README.md`](../../apps/web/README.md).

## What was built, in order

| Commit | Change |
|---|---|
| `b297267` | First cut of the map on mock data: MapLibre map, tile panel, legend, orchestrator client and mock tile generator. |
| `3bdb9c5` | State hover, statewide preview and tile drill-down. |
| `19bcc10` | Terrain under the tile view, fixed compass and scale bar. |
| `b9a5456` | Browser location opens the user's state, zoom-driven focus and unfocus, "← US map" return button. |
| (this branch) | Live / historical mode switch, about 1 km cells, experimental predicted spread, observed perimeters in historical mode. |

## Features

### National view
- All CONUS states outlined (Census Bureau 1:10m via `us-atlas`; Alaska, Hawaii and territories left out, per decision 7).
- Hovering a state lifts it: it grows 8% about its centre with a drop shadow. The lift is instant if the user prefers reduced motion.
- Clicking a state opens it. So does zooming in one level past the national framing (the hovered state, or the one at the centre of the view).
- On load the browser asks for the user's location. If allowed and inside a CONUS state, that state opens and a blue dot marks the user. "Use my location" asks again. Only the state opens, not the tile, since loading a tile activates it.

### State view
- The map frames the state and dims everything outside it.
- Coarse preview: one square per 50 km tile, coloured by that tile's highest cell. Squares with no model output are grey.
- Hovering outlines the tile a click would load.
- "Open the highest-risk tile" jumps straight to the hottest one.
- Clicking a neighbouring state switches to it. "All states", the "← US map" button on the map, Esc, or zooming out one level past the state's framing goes back.

### Tile view (live heat map)
- Full-resolution cells coloured by fire probability (magma-style ramp). Cells get fainter as uncertainty rises.
- Satellite detections drawn as dots that fade over 24 hours. The panel shows tile ID, peak probability, detection count and the age of the newest detection.
- **Terrain underneath the heat map:**
  - Elevation tint (muted, so the probability colours stay dominant).
  - Multidirectional hillshade.
  - Contour lines in metres. Spacing tightens with zoom (100 m at the default tile zoom, down to 10 m close in). Major lines are heavier and labelled when the basemap provides glyphs.
- Cells and preview squares draw lighter in this view so the relief shows through. Terrain hides when you leave the tile.
- The legend gains an elevation section while terrain is shown.

### Map modes
- A "Live / predictive" or "Historical" switch at the top of the panel; a banner over the map names the mode (and day) in every view.
- Historical adds a date field and previous / next day buttons, from 1 Nov 2000 (start of the FIRMS archive) to yesterday.
- Switching keeps the open state and tile and reloads them, so the same place can be compared across modes and days.
- Mode and date go in the URL (`?mode=historical&date=2021-08-20`) for sharing.
- Historical requests use separate read-only `/history/...` routes so a replay never activates a tile (decision 2).
- Historical tiles show the model hindcast, that day's detections (aged from the end of the day) and observed perimeters where mapped (Mendeley: western US, 2020 to 2024).

### Resolution and predicted spread (live)
- Mock cells are now 0.01 degrees, about 1.1 km (0.7 mi), 2,500 per tile (were about 5 km, 100 per tile).
- Cells at 80% or more count as extreme risk. Around them the tile shows spread outlines for 6, 12 and 24 hours and an arrow along the head fire. The panel gives heading, rate, reach in miles and km per horizon, confidence, and the weather used (wind, humidity, temperature). Reach is capped at 9 miles in the mock.
- The shape is the standard wind-driven ellipse (Anderson 1983 length-to-breadth ratio from midflame wind, taken as 0.4 x the 10 m wind). Spread starts at the downwind edge of the extreme cells.
- **Experimental and mock only.** The rate formula is a placeholder; no spread model exists yet (decision 3 has spread as a proof of concept). Labelled "experimental" in the panel.

### Map furniture (all views)
- Fixed north arrow. Map rotation and tilt are disabled so north is always up.
- Scale bar in km/m and mi/ft, measured at the centre of the view and rounded to 1, 2 or 5 x 10^n.
- Bottom right on desktop, top left on phones (where the panel sits at the bottom). On phones the map now frames tiles above the panel instead of under it.
- Zoom buttons top right.

### Data and configuration
- All settings come from `VITE_*` variables, read and validated in `src/config.ts`. There are no built-in defaults; the app shows an error page if a required value is missing.
  - `VITE_MAP_STYLE_URL`: basemap style (example: OpenFreeMap dark).
  - `VITE_USE_MOCK`: serve generated tiles instead of calling the orchestrator.
  - `VITE_ORCHESTRATOR_URL`: required when not mocking.
  - `VITE_TERRAIN_DEM_URL`, `_ENCODING`, `_MAXZOOM`, `VITE_TERRAIN_ATTRIBUTION`: elevation tiles. Leave the URL empty to turn terrain off. The example uses AWS Terrain Tiles (public, no key).
- Contour lines are generated in the browser (`maplibre-contour`, in a web worker) from the same DEM tiles the hillshade uses, so no contour server is needed.
- Proposed API contract: `GET /tiles?lat=&long=` and `GET /states/{fips}/preview`. It was written from the web side only and is not yet agreed.

## Tests

`npm test --workspace @pyro/web`: 103 unit tests covering the client, mock, config (including terrain settings), geometry, state outlines, click handling, geolocation, scale-bar maths, terrain layer building, map modes (URL, date range, routes) and spread geometry. There are no component or end-to-end tests. Each feature was checked by hand in a headless browser.

## Known gaps

- **Spread is mock and ahead of the model.** Nothing predicts spread on the backend. The weather is sampled every 10 km, coarser than the 1 km cells, so detail below that has to come from terrain and fuels.
- **`/history` routes and the `spread` field are web-side proposals.** The orchestrator has neither; the archive would need to be readable per tile and day.
- **Mock data only.** The orchestrator does not implement the endpoints yet, and every number on screen is generated.
- **Statewide preview vs decision 2.** On a real backend most preview squares would be grey, because the model only runs for active tiles. This needs a team decision.
- **Basemap and contour labels not seen end to end.** Testing used a blank style because OpenFreeMap was unreachable from the build sandbox.
- **Terrain adds network load** (about 20 to 40 DEM images per tile view).
- **Licence terms to check before a public launch:** OpenFreeMap and the DEM provider.

## Next steps

1. Agree the tile and preview contract with the orchestrator and inference owners.
2. Agree the `/history` routes and the `spread` / `drivers` / `perimeters` fields; decide whether hindcasts and a spread model are in scope.
3. Verify the real basemap, including contour labels, in a normal browser.
4. Add a national FIRMS detection layer (needs its own endpoint).
5. Load a tile from a shared tile ID in the URL.
6. Decide polling or push for queued tiles.
