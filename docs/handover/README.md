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
| Architecture | Scheduled ingestion per region; burn probability first. See [decisions.md](decisions.md) |
| Model design | Proposed outline only, not agreed, see [model-outline.md](model-outline.md) |
| Ingestion code | Not started |
| Model code | Not started |
| Website / map | Not started |
| Repo | Only the initial commit and a stub README |

## Docs in this folder

- [decisions.md](decisions.md): what the team has decided, with dates
- [data-sources.md](data-sources.md): which sources we use, which we dropped, and why
- [model-outline.md](model-outline.md): proposed structure for the Pyro model
- [risks-and-open-questions.md](risks-and-open-questions.md): known gaps and things nobody has verified yet

## Next steps, in order

1. Request a FIRMS MAP_KEY (free, instant) and submit the FIRMS archive request. The archive is delivered by email with no stated turnaround, so it is the long pole.
2. Make one test call to the FIRMS Area API and record the actual CSV columns per sensor.
3. Decide on a ground-truth label source (see risks doc). Without it the model cannot be validated.
4. Fix the grid: cell size, projection, CONUS extent. Everything else resamples onto it.
5. Pull LANDFIRE fuels and terrain once, resample to the grid, cache.
6. Write ingestion for FIRMS (live) and Open-Meteo (live and historical).
7. Agree the model outline, then implement.

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
