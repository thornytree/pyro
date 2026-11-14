# Risks and open questions

Last updated: 2026-11-14

## Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Label feed is unverified | NIFC / WFIGS is the agreed label source, but its endpoints, fields, history depth and reporting gaps have not been checked. Unreported fires would look like sensor false alarms. | Verify the feed and pull a sample before training. Treat cells without an incident as unlabelled, not negative. |
| Overpass coverage has no source | The agreed model must tell unobserved cells from negative ones, so it needs per-sensor overpass times or masks. | Find a source before writing model code. Fall back to a coarse per-sensor revisit schedule. |
| CONUS-wide weather cost | Any tile can become active, so weather call volume is not bounded by region. | Cap concurrent active tiles; verify the Open-Meteo cap first. |
| Live and training data differ | Near-real-time detections are replaced by science-quality data after about 5 months. | Train on NRT only, or add an NRT-vs-SP calibration term. |
| Open-Meteo model change | HRRR is discontinued on 2026-11-30; RRFS replaces it for North America. | Request RRFS or best match. Never hardcode HRRR. |
| FIRMS archive turnaround unknown | Delivered by email after a request; no stated time. | Submit the request first. Fall back to paging the Area API 5 days at a time. |
| Revisit gaps | Polar orbiters pass a few times a day, so "live" can be hours old. | Show detection age on the map. Consider a geostationary source later (not evaluated). |
| Open-Meteo free-tier limits | A dense CONUS grid polled hourly may exceed the free cap, and the free tier is non-commercial. | Check the pricing page; batch coordinates; coarsen the weather grid and interpolate. |
| Attribution | Mendeley dataset is CC BY 4.0. | Credit it on the site if used. |
| Web app runs on mock data | `apps/web` renders generated tiles; nothing real reaches the map yet. A demo could be mistaken for model output. | Keep the "mock data" badge; implement `GET /tiles` in the orchestrator and switch `VITE_USE_MOCK` off. |
| API contract is one-sided | The tile response shape was defined by the web app alone. Inference may not be able to produce it cheaply (GeoJSON polygons per cell). | Agree it across the three apps before building either side further. |
| Basemap provider terms | The example basemap (OpenFreeMap) was not reachable from the build sandbox and its terms were not read. | Verify it loads and check terms, or pick another MapLibre style. |

## Unverified facts

These came from memory or were not on the pages read. Confirm before building on them.

- FIRMS CSV column names per sensor (`confidence`, `frp`, brightness fields)
- Open-Meteo free-tier daily call cap and licence wording
- LANDFIRE pixel size (expected 30 m)
- Daymet release cadence (expected annual)
- Open-Meteo endpoint hostnames for forecast and archive
- NIFC / WFIGS endpoints, field names, history depth, update cadence and licence
- OpenFreeMap style URL availability and usage terms (example basemap for `apps/web`)

## Open questions for the team

1. Model cell size inside a tile, projection and time step? (Tile size is decided: 50 km.)
2. Where does per-sensor overpass coverage come from?
3. Hosting: where does ingestion run, and how often?
4. Map stack for the frontend: MapLibre GL JS in the first cut (decision 10, pending team review). Basemap provider still open.
6. Is the `GET /tiles` contract proposed in `apps/web/README.md` acceptable to the orchestrator and inference owners?
5. Does a second NASA dataset (for example Daymet) help with judging enough to justify the work?
