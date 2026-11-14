# trigger

Work item 1: user trigger inputs.

- **Input:** `lat`, `long` from the map, or a shared tile ID.
- **Output:** the ID of the tile containing the point. The tile is marked active so the scheduler processes it.

The trigger does not fetch external data itself. Ingestion is scheduled (see `docs/handover/decisions.md`): a request returns the cached result for the tile, or queues the tile if it is not yet active.

## Open questions

- Tile size (recommended: 50 km x 50 km fixed grid).
- What the user sees while a newly requested tile is being processed.
- Validate that the point is inside the supported area (US).
