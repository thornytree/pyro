import { createRegionGrid } from "./region.ts";
import { fetchRaster, rasterCell } from "./raster.ts";
import type { RasterGrid } from "./raster.ts";
import type { dataBundle, TerrainAttributes, TerrainValues } from "./types.ts";

const service = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer";

/** Horn 3x3 gradient in ground metres; aspect is the downhill bearing. */
export function terrainAt(raster: RasterGrid, point: dataBundle["location"]): TerrainValues {
  const { row, column, index } = rasterCell(raster, point);
  const elevation = raster.values[index] ?? null;
  const unknown = { elevation_m: elevation, slope_degrees: null, aspect_degrees: null };
  if (row === 0 || column === 0 || row === raster.height - 1 || column === raster.width - 1) return unknown;
  const window: Array<number | null> = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) window.push(raster.values[(row + dy) * raster.width + column + dx] ?? null);
  }
  if (window.some(value => value === null)) return unknown;
  const [nw, n, ne, w, , e, sw, s, se] = window as number[];
  const metresPerDegree = 6371008.8 * Math.PI / 180;
  const dx = (raster.bounds.east - raster.bounds.west) / raster.width * metresPerDegree * Math.cos(point.latitude * Math.PI / 180);
  const dy = (raster.bounds.north - raster.bounds.south) / raster.height * metresPerDegree;
  const dzdx = (ne! + 2 * e! + se! - nw! - 2 * w! - sw!) / (8 * dx);
  const dzdy = (nw! + 2 * n! + ne! - sw! - 2 * s! - se!) / (8 * dy);
  const gradient = Math.hypot(dzdx, dzdy);
  return {
    elevation_m: elevation,
    slope_degrees: Math.atan(gradient) * 180 / Math.PI,
    aspect_degrees: gradient < 1e-10 ? null : (Math.atan2(-dzdx, -dzdy) * 180 / Math.PI + 360) % 360,
  };
}

/** Fetch a ~30 m DEM, then sample terrain on the common ~1 km output grid. */
export async function getTerrainAttributes(lat: number, long: number): Promise<{ terrain: TerrainAttributes }> {
  const target = createRegionGrid(lat, long, 1);
  const count = Math.ceil(Math.sqrt(300) * 1609.344 / 30);
  const latStep = (target.bounds.north - target.bounds.south) / count;
  const lonStep = (target.bounds.east - target.bounds.west) / count;
  // One DEM pixel of padding supplies neighbours for slope/aspect at the boundary.
  const bounds = {
    west: target.bounds.west - lonStep, east: target.bounds.east + lonStep,
    south: target.bounds.south - latStep, north: target.bounds.north + latStep,
  };
  const raster = await fetchRaster(service, bounds, count + 2, count + 2, "bilinear");
  const cells = target.cells.map(location => ({ ...location, ...terrainAt(raster, location) }));
  return {
    terrain: {
      ...terrainAt(raster, { latitude: lat, longitude: long }),
      source: "USGS 3DEP", source_url: service, dem_sampling_m: 30,
      slope_method: "Horn 3x3", fetched_at: raster.fetched_at,
      grid: { bounds: target.bounds, rows: target.rows, columns: target.columns, cells },
    },
  };
}
