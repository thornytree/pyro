# trigger

Work item 1: user trigger inputs. Part of the TypeScript orchestrator.

- **Input:** `lat`, `long` from the map, or a shared tile ID.
- **Output:** the ID of the tile containing the point. The tile is marked active so the scheduler processes it.

The trigger does not fetch external data itself. Ingestion is scheduled (see `../../../../docs/handover/decisions.md`): a request returns the cached result for the tile (from the `apps/inference` API), or queues the tile if it is not yet active.

## What `apps/web` expects

The web app (added 2026-11-14) calls `GET /tiles?lat=<number>&long=<number>` and expects the response described under "Proposed API contract" in `apps/web/README.md` (types in `apps/web/src/api/types.ts`). It also calls `GET /states/{fips}/preview` for a coarse per-tile overview of one state (same README). Both are proposals from the web side, not agreed interfaces, and nothing here implements them yet. Change them on both sides together.

## Open questions

- Agree or amend the `GET /tiles` and `GET /states/{fips}/preview` contracts proposed by `apps/web`, including the error body and status code for a point outside CONUS.
- What the state preview shows for tiles that are not active and so have no model output (see the caveat in `apps/web/README.md`).

- Tile ID scheme and projection for the 50 km x 50 km grid (tile size decided 2026-11-14).
- What the user sees while a newly requested tile is being processed.
- Validate that the point is inside the supported area (CONUS).
