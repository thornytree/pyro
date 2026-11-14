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
| Ingestion code | Not started |
| Model code | Not started |
| Website / map | Not started |
| Repo | App scaffolds under `apps/`, docs and folder READMEs |

## Docs in this folder

- [decisions.md](decisions.md): what the team has decided, with dates
- [data-sources.md](data-sources.md): which sources we use, which we dropped, and why
- [model-outline.md](model-outline.md): agreed structure for the Pyro model
- [risks-and-open-questions.md](risks-and-open-questions.md): known gaps and things nobody has verified yet

## Next steps, in order

1. Request a FIRMS MAP_KEY (free, instant) and submit the FIRMS archive request. The archive is delivered by email with no stated turnaround, so it is the long pole.
2. Make one test call to the FIRMS Area API and record the actual CSV columns per sensor.
3. Verify the NIFC / WFIGS feed (endpoints, fields, history depth) and pull a sample. It is the agreed label source.
4. Fix the rest of the grid: model cell size, projection, time step. Tiles are 50 km x 50 km across CONUS. Everything else resamples onto it.
5. Pull LANDFIRE fuels and terrain once, resample to the grid, cache.
6. Write ingestion for FIRMS (live) and Open-Meteo (live and historical).
7. Find a per-sensor overpass coverage source, then implement the model.

## Conventions

- Secrets (FIRMS `MAP_KEY`, any API tokens) come from environment variables. Never commit them; add `.env` to `.gitignore` before the first ingestion commit.
- Source choices were checked against the providers' own pages on 2026-11-14. Re-check anything marked "unverified" before relying on it.

## Repo layout

Added 2026-11-14, moved under `apps/` the same day to match the team structure. One folder per work item; each has a README with inputs, outputs and open questions.

- `apps/web/`: the map site (TypeScript, React/Vite)
- `apps/orchestrator/`: public API (TypeScript, Express)
- `apps/orchestrator/trigger/`: lat/long input
- `apps/inference/`: Python pipeline and model, exposed via FastAPI
- `apps/inference/sources/{firms,weather,topography,daymet}/`: one fetcher per external source
- `apps/inference/harmonization/`: builds the data bundle
- `apps/inference/model/{training,inference}/`
- `apps/inference/shared/`: schemas, grid, config
