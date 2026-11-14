# model/inference

- **Input:** real-time bundle from `harmonization`, model artifact from `training/`.
- **Exposed as:** a FastAPI endpoint called by `apps/orchestrator`.
- **Output:** per-cell burn probability with uncertainty; later, spread direction, rate and predicted perimeter.

## Open questions

- Response format for the `apps/web` heat map. `apps/web/README.md` proposes GeoJSON cell polygons in EPSG:4326 with `probability` and `uncertainty` (both 0 to 1) per cell. Not agreed; payload size at small cell sizes is unchecked.
- What `uncertainty` means (posterior standard deviation, interval width) and how it maps to 0 to 1.
- Latency budget per request.
