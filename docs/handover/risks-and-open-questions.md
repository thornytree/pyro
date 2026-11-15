# Risks and open questions

Last updated: 2026-11-14 (evening, after the FIRMS harmonization and orchestrator fan-out)

## Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Label feed is unverified | NIFC / WFIGS is the agreed label source, but its endpoints, fields, history depth and reporting gaps have not been checked. Unreported fires would look like sensor false alarms. | Verify the feed and pull a sample before training. Treat cells without an incident as unlabelled, not negative. |
| Overpass coverage has no source | The agreed model must tell unobserved cells from negative ones, so it needs per-sensor overpass times or masks. | Find a source before writing model code. Fall back to a coarse per-sensor revisit schedule. |
| CONUS-wide weather cost | Any tile can become active, so weather call volume is not bounded by region. | Cap concurrent active tiles; verify the Open-Meteo cap first. |
| Live and training data differ | Near-real-time detections are replaced by science-quality data after about 5 months. | Train on NRT only, or add an NRT-vs-SP calibration term. |
| Open-Meteo model change | HRRR is discontinued on 2026-11-30; RRFS replaces it for North America. | Request RRFS or best match. Never hardcode HRRR. |
| Orchestrator not wired or run | The scheduler starts when `FIRMS_MAP_KEY` is set, but no Express route calls `requestTileAt`, and the fetchers have not been run against the real APIs. Integration testing is planned once the orchestrator is further along. | Wire `GET /tiles` once the contract is agreed, then integration-test. |
| Grid defined twice | The tile grid exists in Python (`apps/inference/shared/grid.py`) and TypeScript (`apps/orchestrator/src/fan-out/grid.ts`). They agree today, but a change to one must be copied to the other. The web mock still uses its own IDs. | Change both together; switch the web mock to `r..c..` IDs. |
| Landsat-only detections may not be wildfires | Landsat catches small fires the other sensors miss, but has no `type` flag, and many are likely agricultural or prescribed burns or industrial heat. | Let the model learn Landsat's false-alarm rate from WFIGS labels; consider masking persistent hot cells. |
| S-NPP archive ends 2 November | Other sensors run to 14 November. | Fill the gap from the live API, or check whether the archive request was cut short. |
| Alaska and Hawaii untiled | About 1.5 M harmonized detections fall outside the CONUS grid. | Filter them for training, or extend the grid if coverage grows. |
| Harmonized data is CSV, not Parquet | pyarrow was not installed when the run happened. | Run `uv sync`, then the rewrite command in `apps/inference/sources/firms/README.md`. |
| Revisit gaps | Polar orbiters pass a few times a day, so "live" can be hours old. | Show detection age on the map. Consider a geostationary source later (not evaluated). |
| Open-Meteo free-tier limits | A dense CONUS grid polled hourly may exceed the free cap, and the free tier is non-commercial. | Check the pricing page; batch coordinates; coarsen the weather grid and interpolate. |
| Attribution | Mendeley dataset is CC BY 4.0. | Credit it on the site if used. |
| Web app shows mock model output | Against the orchestrator the map shows real detections only; probability cells, spread and historical mode are generated with `VITE_USE_MOCK=true`. A mock demo could be mistaken for model output. | Keep the "mock data" badge; switch to real cells once inference is connected. |
| Inference contract undefined | The orchestrator implements the web tile envelope, but the orchestrator-to-inference request and response do not exist. Inference may not produce GeoJSON polygons per cell cheaply. | Agree it (proposal in `apps/inference/model/inference/README.md`) before building the service. |
| No model in the pipeline | The orchestrator returns observations only; nothing trains or serves the Pyro model, and there is no inference route or call. Every probability on the map is mock. | Follow the order in `apps/README.md`: bundle schema, grid, labels, training data, model, inference service, orchestrator call. |
| Train/serve feature mismatch | Live weather is NOAA RRFS; training will need a different historical product. LANDFIRE is fetched at one vintage (LF2025) regardless of date. | Compare the training weather with RRFS on an overlapping period; use fuel vintages matching each training year. |
| Bundle schema in two languages | `dataBundle` is defined in TypeScript; the Python service will need its own copy. | One schema, changed on both sides together, with a test against a real `/tiles` response. |
| Per-click fan-out cost | Each click fetches five providers (several HTTP requests each); one failure fails the whole tile (502). Latency and provider quotas are untested under load. | Decide request-driven vs scheduled (decisions.md, 2026-11-15 table); consider returning partial data when a non-essential source fails. |
| Spread shown before a spread model exists | The live map draws predicted spread outlines from a mock formula (wind, humidity). It could be read as a real forecast, which matters if it reaches public safety users. | Keep the "experimental" and "mock data" labels; replace it with model output checked against the historical perimeters before any outside demo. |
| Basemap provider terms | The example basemap (OpenFreeMap) was not reachable from the build sandbox and its terms were not read. | Verify it loads and check terms, or pick another MapLibre style. |

## Unverified facts

These came from memory or were not on the pages read. Confirm before building on them.

- FIRMS Area API column names per sensor. The archive CSVs are now verified (see `apps/inference/sources/firms/README.md`); the API has not been called. The orchestrator parser assumes `latitude, longitude, acq_date, acq_time, satellite, confidence, frp, scan, track`.
- VIIRS NOAA-21 start date: `data-sources.md` gives 2024-01-17, but the harmonized archive has NOAA-21 rows from March 2023.
- Python FIRMS tests pass in Claude's cloud workspace but have not been run on the Windows computer; orchestrator tests have not been run anywhere.
- Open-Meteo free-tier daily call cap and licence wording
- LANDFIRE pixel size (expected 30 m)
- Daymet release cadence (expected annual)
- Open-Meteo endpoint hostnames for forecast and archive
- NIFC / WFIGS endpoints, field names, history depth, update cadence and licence
- OpenFreeMap style URL availability and usage terms (example basemap for `apps/web`)

## Open questions for the team

0. Request-driven fetching (running code) or scheduled ingestion per 50 km tile (decisions 2 and 11)? See the 2026-11-15 table in `decisions.md`. Several questions below depend on it.
1. Model cell size and time step? The fan-out's 28 x 28 grid (about 1 km over a 300-square-mile region) is the candidate. Is the working 50 km projection (EPSG:5070, IDs like `r40c80`) still needed?
2. Where does per-sensor overpass coverage come from?
3. Hosting: where does ingestion run, and how often?
4. Map stack for the frontend: MapLibre GL JS in the first cut (decision 10, pending team review). Basemap provider and DEM source for terrain still open.
5. Does a second NASA dataset (for example Daymet) help with judging enough to justify the work?
6. `GET /tiles` is implemented. What should `GET /states/{fips}/preview` show, given that model output exists only for clicked regions? And what is the orchestrator-to-inference contract (proposal in `apps/inference/model/inference/README.md`)?
7. Are the polling cadence (FIRMS every 15 minutes, weather hourly) and the 200 active-tile cap right? (Only relevant if the scheduler is used.)
8. What does the historical map mode show: archived observations and perimeters only, or model hindcasts too (which need a trained model)? The web side proposes read-only `/history` routes with a daily time step, from November 2000.
9. Should the live model predict spread (the web shows 6, 12 and 24 h outlines from a mock formula)? If so, who builds it, and how is it checked against the historical perimeters? Weather is sampled every 10 km, coarser than the 1 km cells the web now assumes.
