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
| Web app runs on mock data | `apps/web` renders generated tiles; nothing real reaches the map yet. A demo could be mistaken for model output. | Keep the "mock data" badge; implement `GET /tiles` in the orchestrator and switch `VITE_USE_MOCK` off. |
| API contract is one-sided | The tile response shape was defined by the web app alone. Inference may not be able to produce it cheaply (GeoJSON polygons per cell). | Agree it across the three apps before building either side further. |
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

1. Model cell size inside a tile and time step? Is the working projection (EPSG:5070, IDs like `r40c80`) acceptable? (Tile size is decided: 50 km.)
2. Where does per-sensor overpass coverage come from?
3. Hosting: where does ingestion run, and how often?
4. Map stack for the frontend: MapLibre GL JS in the first cut (decision 10, pending team review). Basemap provider and DEM source for terrain still open.
5. Does a second NASA dataset (for example Daymet) help with judging enough to justify the work?
6. Are the `GET /tiles` and `GET /states/{fips}/preview` contracts proposed in `apps/web/README.md` acceptable to the orchestrator and inference owners? What should the preview show for inactive tiles?
7. Are the polling cadence (FIRMS every 15 minutes, weather hourly) and the 200 active-tile cap right?
8. What does the historical map mode show: archived observations and perimeters only, or model hindcasts too (which need a trained model)? Over what date range and time step? It needs a read-only, date-scoped endpoint that does not activate tiles.
