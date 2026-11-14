# trigger

Work item 1: user trigger inputs. Part of the TypeScript orchestrator.

- **Input:** `lat`, `long` from the map, or a shared tile ID.
- **Output:** the ID of the tile containing the point. The tile is marked active so the scheduler processes it.

The trigger does not fetch external data itself. Ingestion is scheduled (see `docs/handover/decisions.md`): a request returns the cached result for the tile (from the `apps/inference` API), or queues the tile if it is not yet active.

## Open questions

- Tile ID scheme and projection for the 50 km x 50 km grid (tile size decided 2026-11-14).
- What the user sees while a newly requested tile is being processed.
- Validate that the point is inside the supported area (CONUS).
