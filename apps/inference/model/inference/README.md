# model/inference

- **Input:** real-time bundle from `harmonization`, model artifact from `training/`.
- **Exposed as:** a FastAPI endpoint called by `apps/orchestrator`.
- **Output:** per-cell burn probability with uncertainty; later, spread direction, rate and predicted perimeter.

## Open questions

- Response format for the `apps/web` heat map.
- Latency budget per request.
