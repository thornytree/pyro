# Front end: work so far

Last updated: 2026-11-14. Branch: `front-end-mockup` (merged to `main`).

The map site lives in `apps/web` (React, Vite, MapLibre GL JS). It runs on generated mock data. No real model output is wired in yet. Setup, the API contract and a full list of caveats are in [`apps/web/README.md`](../../apps/web/README.md).

## What was built, in order

| Commit | Change |
|---|---|
| `b297267` | First cut of the map on mock data: MapLibre map, tile panel, legend, orchestrator client and mock tile generator. |
| `3bdb9c5` | State hover, statewide preview and tile drill-down. |
| `19bcc10` | Terrain under the tile view, fixed compass and scale bar. |
| `cf9a4b2` | Browser location opens the user's state, zoom-driven focus and unfocus, "← US map" return button. |

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

### Map furniture (all views)
- Fixed north arrow. Map rotation and tilt are disabled so north is always up.
- Scale bar in km/m and mi/ft, measured at the centre of the view and rounded to 1, 2 or 5 x 10^n.
- Bottom right on desktop, top left on phones (where the panel sits at the bottom).
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

`npm test --workspace @pyro/web`: 67 unit tests covering the client, mock, config (including terrain settings), geometry, state outlines, click handling, scale-bar maths and terrain layer building. There are no component or end-to-end tests. Each feature was checked by hand in a headless browser.

## Known gaps

- **Mock data only.** The orchestrator does not implement the endpoints yet, and every number on screen is generated.
- **Statewide preview vs decision 2.** On a real backend most preview squares would be grey, because the model only runs for active tiles. This needs a team decision.
- **Basemap and contour labels not seen end to end.** Testing used a blank style because OpenFreeMap was unreachable from the build sandbox.
- **Terrain adds network load** (about 20 to 40 DEM images per tile view).
- **Licence terms to check before a public launch:** OpenFreeMap and the DEM provider.

## Next steps

1. Agree the tile and preview contract with the orchestrator and inference owners.
2. Verify the real basemap, including contour labels, in a normal browser.
3. Add a national FIRMS detection layer (needs its own endpoint).
4. Load a tile from a shared tile ID in the URL.
5. Decide polling or push for queued tiles.
