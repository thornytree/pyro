# Handover: pyro (NASA hackathon 2026)

Last updated: 2026-11-15

## Goal

A website showing an interactive, continuously updated heat map of US wildfires, current and predicted. A Pyro (probabilistic) model arbitrates between several live and historical fire and weather sources and outputs a per-cell fire probability with confidence.

Later: predict spread direction and coverage with a confidence matrix, and relay it to public safety services (fire, law enforcement).

Hard requirement: at least one NASA dataset or API. NASA FIRMS covers it.

## Status

| Area | State |
|---|---|
| Data source selection | Decided, see [data-sources.md](data-sources.md). Terrain now comes from USGS 3DEP and live weather from NOAA RRFS via Open-Meteo (see the 2026-11-15 notes there). |
| Architecture | **Running:** request-driven. `GET /tiles` fetches all five sources for a 300-square-mile region centred on the clicked point. **Decided (2 and 11):** scheduled ingestion per 50 km tile; that code exists but is not started. The team needs to confirm which design stays; see [decisions.md](decisions.md). |
| Model design | Structure agreed (latent fire state, per-sensor likelihoods), see [model-outline.md](model-outline.md) |
| FIRMS archive | Done. 21.0 M detections from all five sensors harmonized into one schema in `data/firms_harmonized` (gitignored). See [firms-harmonization.md](firms-harmonization.md) |
| Live data retrieval | Done in `apps/orchestrator/src/fan-out/`: FIRMS (MODIS/VIIRS), NOAA RRFS weather via Open-Meteo, Daymet (Earthdata), USGS 3DEP terrain, LANDFIRE fuels, normalized onto a 28 x 28 (about 1 km) grid. Needs `FIRMS_MAP_KEY` and `EARTHDATA_TOKEN`. NIFC / WFIGS not started. |
| Orchestrator API | `GET /health` and `GET /tiles` work and return `status: "observed"` (detections and the source bundle, no model cells). `GET /states/{fips}/preview` returns empty. No inference call; no `/history` routes. |
| Training data | **First version built.** FIRMS, Open-Meteo history, Daymet and LANDFIRE topography joined per 10 km cell-day: 8,071 complete rows, split 60/20/20 by date, in `data/training/compiled` (gitignored). Target is a FIRMS detection, not a WFIGS label; fuels are not included. See [compiled-dataset.md](compiled-dataset.md). |
| Model code | **Not started.** No training, no inference service, no Python mirror of the bundle schema. |
| Website / map | `apps/web`: national view, state hover and preview, tile drill-down, terrain, compass and scale bar, browser location, live/predictive and historical modes, about 1 km cells, experimental predicted spread. Shows real detections from the orchestrator; cells, spread, preview and historical mode only work on mock data. See [frontend.md](frontend.md). |

## Docs in this folder

- [decisions.md](decisions.md): what the team has decided, with dates
- [data-sources.md](data-sources.md): which sources we use, which we dropped, and why
- [model-outline.md](model-outline.md): agreed structure for the Pyro model
- [frontend.md](frontend.md): what the map site does so far, and its gaps
- [firms-harmonization.md](firms-harmonization.md): results and caveats of the FIRMS archive harmonization
- [training-bundle.md](training-bundle.md): steps and status of combining FIRMS with weather, topography and Daymet for training
- [compiled-dataset.md](compiled-dataset.md): the joined training table, its columns, the train / validation / test split and its limits
- [risks-and-open-questions.md](risks-and-open-questions.md): known gaps and things nobody has verified yet

## Done

2026-11-14:

- FIRMS archive obtained and harmonized for MODIS, VIIRS S-NPP, NOAA-20, NOAA-21 and Landsat ([firms-harmonization.md](firms-harmonization.md)).
- 50 km CONUS tile grid as a working choice: EPSG:5070, 95 x 59 tiles, IDs like `r40c80` (`apps/inference/shared/grid.py`). Not yet agreed.
- Scheduled ingestion (nationwide FIRMS poll, weather per active tile) written in `apps/orchestrator/src/fan-out/` (decision 11); Landsat assessed and added (decision 12).
- Web map: state hover, statewide preview, tile drill-down, terrain, compass and scale bar.

2026-11-15:

- Orchestrator serves `GET /tiles`: concurrent fetch of FIRMS, NOAA weather, Daymet, 3DEP and LANDFIRE for a centred 300-square-mile region, with safe error reporting. 25 tests.
- Web map: live / historical mode switch, about 1 km cells, experimental spread, and display of the orchestrator's observed tiles.
- Training downloads finished for now: Daymet for 24,857 cells, Open-Meteo history for 9,000 cell-days, LANDFIRE 2020 elevation, slope and aspect.
- Training table compiled from all four sources and split into train, validation and test, 60/20/20 by date ([compiled-dataset.md](compiled-dataset.md)).

## Next steps, in order

The remaining work is mostly the model and wiring it in. `apps/README.md` has the same list with more detail.

1. **Confirm the architecture.** Request-driven (running) or scheduled per 50 km tile (decisions 2 and 11). This also settles the grid and the shareable location ID.
2. **Mirror the bundle schema in Python** (`apps/inference/shared/`) from `apps/orchestrator/src/fan-out/types.ts`.
3. **Decide the model cell grid and time step.** The fan-out's 28 x 28 (about 1 km) grid is the obvious candidate.
4. **Verify NIFC / WFIGS** (endpoints, fields, history depth) and pull a sample. It is the agreed label source.
5. **Build historical training bundles** with the same features as live: harmonized FIRMS, historical weather comparable to NOAA RRFS, LANDFIRE fuels of matching vintage. A first table exists on the 10 km daily grid ([compiled-dataset.md](compiled-dataset.md)); still missing are WFIGS labels, fuels, and more Open-Meteo days (about 9,000 cell-days per daily run).
6. **Find a per-sensor overpass coverage source**, then train the model.
7. **Inference service:** FastAPI `POST` route taking a bundle and returning per-cell probability and uncertainty.
8. **Orchestrator integration:** call inference from `GET /tiles`, return `status: "ready"` with cells, fall back to `observed` on failure.
9. **Web:** real cells then show automatically; decide the state preview, the `/history` routes and whether spread is built for real.
10. Verify the basemap end to end and check provider terms (OpenFreeMap, DEM tiles, Open-Meteo) before any public demo.

## Conventions

- Secrets (`FIRMS_MAP_KEY`, `EARTHDATA_TOKEN`) live in `apps/orchestrator/.env`, which is gitignored. Never commit them or give them a `VITE_` prefix.
- Source choices were checked against the providers' own pages on 2026-11-14. Re-check anything marked "unverified" before relying on it.

## Repo layout

One folder per work item; each has a README with status, inputs, outputs and open questions.

- `apps/web/`: the map site (TypeScript, React/Vite, MapLibre GL JS)
- `apps/orchestrator/`: public API (TypeScript, Express). `src/app.ts` routes, `src/config.ts` environment.
- `apps/orchestrator/src/fan-out/`: source retrieval and normalization for a requested point (FIRMS, Open-Meteo, Daymet, 3DEP, LANDFIRE), plus the unused scheduler and 50 km grid
- `apps/inference/`: Python model side, to be exposed via FastAPI
- `apps/inference/sources/firms/`: FIRMS archive tooling. The other `sources/*` folders have READMEs only; live retrieval moved to the orchestrator.
- `apps/inference/harmonization/`: training bundle steps (FIRMS per cell-day, sample, weather queue, `compile_dataset.py`). Features from a live bundle are not started.
- `apps/inference/model/{training,inference}/` (not started)
- `apps/inference/shared/`: FIRMS schema and 50 km grid
