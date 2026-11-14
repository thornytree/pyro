# sources/topography

Work item 2: terrain and elevation.

- **Provider:** LANDFIRE (elevation, slope, aspect), EPSG:5070 for CONUS.
- **Input:** region of interest.
- **Output:** elevation, slope, aspect per grid cell.

## Notes

- Terrain does not change. Download once, resample to the project grid, cache, and serve lookups from the cache. Do not call a remote service per request.
- Open question: add LANDFIRE fuel and canopy layers here. They come from the same download and matter a lot for spread.
