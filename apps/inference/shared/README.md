# shared

Code and definitions used by more than one folder in `apps/inference`.

- Bundle schema and the unified FIRMS schema.
- Grid definition (cell size, projection, extent).
- Config loading. Secrets come from environment variables only.

## What exists

- `firms_schema.py`: the unified FIRMS detection schema (columns, dtypes, dedupe key).
- `grid.py`: EPSG:5070 projection and the 50 km tile grid (95 x 59 tiles, IDs like `r40c80`, row 0 in the south). The projection and frame are a working choice, not yet a team decision; they are constants in this one file.

## To build

- A Python mirror of the orchestrator's `dataBundle` type (`apps/orchestrator/src/fan-out/types.ts`) for the inference request. Keep the two in step.
- Note: the orchestrator's live requests use a 300-square-mile region centred on the point, with its own 28 x 28 sampling grid, not the 50 km tiles here. The 50 km grid is used by the FIRMS archive and the orchestrator's optional scheduler. Which one identifies model output and shareable locations is open.
