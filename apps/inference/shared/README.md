# shared

Code and definitions used by more than one folder in `apps/inference`.

- Bundle schema and the unified FIRMS schema.
- Grid definition (cell size, projection, extent).
- Config loading. Secrets come from environment variables only.

## What exists

- `firms_schema.py`: the unified FIRMS detection schema (columns, dtypes, dedupe key).
- `grid.py`: EPSG:5070 projection and the 50 km tile grid (95 x 59 tiles, IDs like `r40c80`, row 0 in the south). The projection and frame are a working choice, not yet a team decision; they are constants in this one file.
