# web

The website: interactive US heat map of current and predicted wildfires.

- Sends `lat`, `long` to `apps/orchestrator` (`trigger/`). Base URL comes from `VITE_ORCHESTRATOR_URL`.
- Renders model output from `apps/inference/model/inference`, relayed by the orchestrator.

## Open questions

- Map library.
- How detection age and confidence are shown.
- Attribution for data sources (NASA FIRMS, Open-Meteo, LANDFIRE, and CC BY 4.0 for the Mendeley dataset if used).
