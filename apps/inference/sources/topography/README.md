# sources/topography

Terrain retrieval is implemented in
[`apps/orchestrator/src/fan-out/terrain.ts`](../../../orchestrator/src/fan-out/terrain.ts).

- Provider: USGS 3DEP raw elevation ImageServer.
- Input: selected latitude/longitude; shared centered 300-square-mile region.
- Output: elevation (metres), derived slope (degrees), downhill aspect (degrees),
  sampled onto the common grid. Missing values and undefined flat aspects are null.
- Derivatives use a roughly 30 m DEM with boundary padding and metric distances.
- Static downloads use a bounded in-memory cache for 24 hours.

Fuels, vegetation and canopy retrieval is implemented separately in
[`landfire.ts`](../../../orchestrator/src/fan-out/landfire.ts), using six raw
LANDFIRE ImageServer layers. See the fan-out README for versions, units, sampling
limitations, cache behavior and live validation status. The Python inference service
receives normalized JSON rather than retrieving these source rasters itself.
