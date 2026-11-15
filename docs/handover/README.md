# Handover: pyro (NASA hackathon 2026)

Last updated: 2026-11-14

## Goal

A website showing an interactive, continuously updated heat map of US wildfires, current and predicted. A Pyro (probabilistic) model arbitrates between several live and historical fire and weather sources and outputs a per-cell fire probability with confidence.

Later: predict spread direction and coverage with a confidence matrix, and relay it to public safety services (fire, law enforcement).

Hard requirement: at least one NASA dataset or API. NASA FIRMS covers it.

## Status

| Area | State |
|---|---|
| Data source selection | Decided, see [data-sources.md](data-sources.md) |
| Architecture | Scheduled ingestion per 50 km tile, all of CONUS; burn probability first. See [decisions.md](decisions.md) |
| Model design | Structure agreed (latent fire state, per-sensor likelihoods), see [model-outline.md](model-outline.md) |
| FIRMS archive | Done. 21.0 M detections from all five sensors harmonized into one schema in `data/firms_harmonized` (gitignored). See [firms-harmonization.md](firms-harmonization.md) |
| Ingestion code | Started. Python: FIRMS archive normalizer and loader in `apps/inference/sources/firms/`, schema and 50 km grid in `apps/inference/shared/`. TypeScript: scheduled ingestion in `apps/orchestrator/src/fan-out/` (decision 2): nationwide FIRMS poll of all five sensors, per-active-tile Open-Meteo sampling, tile lifecycle. Not yet wired to a route or run against the live APIs. NIFC / WFIGS, LANDFIRE and Daymet not started |
| Model code | Not started |
| Website / map | `apps/web`: MapLibre map with national view, state hover, statewide preview and tile drill-down; opens the user's state from browser location; zoom in/out focuses and leaves states; terrain (elevation tint, hillshade, contours) under the tile view, compass and scale bar. Live/predictive and historical modes with a switch (mode and date in the URL); about 1 km cells; experimental predicted spread (6/12/24 h outlines around cells at 80% or more) from a mock formula. Runs on mock data only; the API contracts are web-side proposals. See [frontend.md](frontend.md) and `apps/web/README.md` |
| Orchestrator | Express server that starts the ingestion scheduler when `FIRMS_MAP_KEY` is set. `GET /tiles` and `GET /states/{fips}/preview` are not implemented |
| Repo | App scaffolds under `apps/`, docs and folder READMEs |

## Docs in this folder

- [decisions.md](decisions.md): what the team has decided, with dates
- [data-sources.md](data-sources.md): which sources we use, which we dropped, and why
- [model-outline.md](model-outline.md): agreed structure for the Pyro model
- [frontend.md](frontend.md): what the map site does so far, and its gaps
- [firms-harmonization.md](firms-harmonization.md): results and caveats of the FIRMS archive harmonization
- [risks-and-open-questions.md](risks-and-open-questions.md): known gaps and things nobody has verified yet

## Done (2026-11-14)

- FIRMS archive obtained and harmonized for MODIS, VIIRS S-NPP, NOAA-20, NOAA-21 and Landsat; archive CSV columns verified ([firms-harmonization.md](firms-harmonization.md)).
- 50 km CONUS tile grid implemented as a working choice: EPSG:5070, 95 x 59 tiles, IDs like `r40c80` (`apps/inference/shared/grid.py`). Not yet agreed by the team.
- Live fetchers reworked to follow decision 2: FIRMS polled nationwide every 15 minutes, weather for active tiles only, tiles expire after 24 hours unviewed (`apps/orchestrator/src/fan-out/`, decision 11). The TypeScript tile grid matches the Python one.
- Landsat assessed on the archive and added to the live poll (decision 12).
- Web map extended with state hover, statewide preview, tile drill-down, terrain, compass and scale bar.

## Next steps, in order

1. Agree the grid projection and tile IDs (working choice above), then switch the web mock to the same IDs.
2. Wire `GET /tiles` to the scheduler and integration-test the orchestrator.
3. Make one test call to the FIRMS Area API (a MAP_KEY is needed for the fan-out) and record the live CSV columns per sensor.
4. Verify the NIFC / WFIGS feed (endpoints, fields, history depth) and pull a sample. It is the agreed label source.
5. Decide model cell size and time step inside a tile.
6. Pull LANDFIRE fuels and terrain once, resample to the grid, cache.
7. Historical Open-Meteo ingestion for training, aligned to the harmonized FIRMS dates and tiles.
8. Find a per-sensor overpass coverage source, then implement the model.
9. Implement `GET /tiles` in the orchestrator and turn `VITE_USE_MOCK` off.
10. Agree the `/history` routes and the `spread` field (proposed in `apps/web/README.md`), and decide who builds a real spread model to replace the web mock. See [frontend.md](frontend.md).

## Conventions

- Secrets (FIRMS `MAP_KEY`, any API tokens) come from environment variables. Never commit them; add `.env` to `.gitignore` before the first ingestion commit.
- Source choices were checked against the providers' own pages on 2026-11-14. Re-check anything marked "unverified" before relying on it.

## Repo layout

Added 2026-11-14, moved under `apps/` the same day to match the team structure. One folder per work item; each has a README with inputs, outputs and open questions.

- `apps/web/`: the map site (TypeScript, React/Vite, MapLibre GL JS)
- `apps/orchestrator/`: public API (TypeScript, Express)
- `apps/orchestrator/src/fan-out/`: lat/long input and on-demand FIRMS and Open-Meteo fetchers (moved from `trigger/`; its README still carries the trigger notes)
- `apps/inference/`: Python pipeline and model, exposed via FastAPI
- `apps/inference/sources/{firms,weather,topography,daymet}/`: one fetcher per external source
- `apps/inference/harmonization/`: builds the data bundle
- `apps/inference/model/{training,inference}/`
- `apps/inference/shared/`: schemas, grid, config
