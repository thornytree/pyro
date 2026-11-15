# model/inference

Status (2026-11-15): `occurrence.py` (`POST /predict`) and `spread.py` (`POST /spread`) take the bundle and return GeoJSON as proposed below, plus `riskScore` per cell. The orchestrator side is not built. See `docs/handover/models.md`.

- **Input:** the `dataBundle` the orchestrator builds in `GET /tiles` (see `apps/orchestrator/src/fan-out/types.ts`), plus the model artifact from `training/`.
- **Exposed as:** a FastAPI route called by `apps/orchestrator` after fan-out.
- **Output:** per-cell burn probability with uncertainty; later, spread.

## Proposed shape (not agreed)

The orchestrator already returns the web's tile envelope with empty `cells`. The simplest integration is for inference to fill them:

- Request: `POST /predict` with the bundle as JSON.
- Response: `cells` as a GeoJSON FeatureCollection of Polygons in EPSG:4326, properties `probability` and `uncertainty` (both 0 to 1), plus `updatedAt` and a model version. Later, optional `spread` (see `apps/web/README.md`).
- Orchestrator: merges `cells` into the tile response, sets `status: "ready"` and `updatedAt`, and falls back to `observed` if inference fails or times out.

## Open questions

- What `uncertainty` means (posterior standard deviation, interval width) and how it maps to 0 to 1.
- Latency budget. The fan-out already waits for five providers per click.
- Payload size: 28 x 28 cells is small as GeoJSON; much finer cells would need a raster or array format.
