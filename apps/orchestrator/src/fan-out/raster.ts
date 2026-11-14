import { fromArrayBuffer } from "geotiff";
import type { BoundingBox, dataBundle } from "./types.ts";

export type RasterGrid = {
  bounds: BoundingBox;
  fetched_at: string;
  width: number;
  height: number;
  values: Array<number | null>;
};

/** Read raw single-band, north-up WGS84 pixels, rejecting rendered RGB maps. */
export async function decodeRaster(data: ArrayBuffer): Promise<RasterGrid> {
  const image = await (await fromArrayBuffer(data)).getImage();
  if (image.getSamplesPerPixel() !== 1 || image.getGeoKeys()?.GeographicTypeGeoKey !== 4326) {
    throw new Error("Expected a raw single-band EPSG:4326 raster.");
  }
  const [dx, dy] = image.getResolution();
  if (!(dx! > 0) || !(dy! < 0)) throw new Error("Expected a north-up raster.");
  const [west, south, east, north] = image.getBoundingBox();
  if (![west, south, east, north].every(Number.isFinite)) throw new Error("Invalid raster extent.");
  const width = image.getWidth();
  const height = image.getHeight();
  const raw = await image.readRasters({ samples: [0], interleave: true });
  const nodata = image.getGDALNoData();
  const values = Array.from(raw as ArrayLike<number>, value =>
    !Number.isFinite(value) || value === nodata || value === -9999 || value < -1e30 ? null : value);
  if (values.length !== width * height || !values.some(value => value !== null)) {
    throw new Error("Raster has no usable data or incomplete coverage.");
  }
  return { fetched_at: new Date().toISOString(), bounds: { west: west!, south: south!, east: east!, north: north! }, width, height, values };
}

// Small bounded in-memory cache; no new service or persistent storage needed.
const cache = new Map<string, { expires: number; result: Promise<RasterGrid> }>();
export function clearRasterCache(): void { cache.clear(); }

export async function fetchRaster(
  service: string,
  bounds: BoundingBox,
  width: number,
  height: number,
  interpolation: "nearest" | "bilinear",
): Promise<RasterGrid> {
  const url = new URL(`${service}/exportImage`);
  const params = {
    bbox: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    bboxSR: "4326", imageSR: "4326", size: `${width},${height}`,
    adjustAspectRatio: "false", format: "tiff", pixelType: "F32", f: "image",
    interpolation: interpolation === "nearest" ? "RSP_NearestNeighbor" : "RSP_BilinearInterpolation",
    renderingRule: JSON.stringify({ rasterFunction: "None" }),
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const key = url.toString();
  const existing = cache.get(key);
  if (existing && existing.expires > Date.now()) return existing.result;
  if (cache.size >= 16) cache.delete(cache.keys().next().value!);
  const result = (async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Raster service returned HTTP ${response.status}.`);
    const raster = await decodeRaster(await response.arrayBuffer());
    if (raster.width !== width || raster.height !== height) throw new Error("Unexpected raster dimensions.");
    for (const edge of ["west", "south", "east", "north"] as const) {
      if (Math.abs(raster.bounds[edge] - bounds[edge]) > 1e-6) {
        throw new Error("Raster extent does not match the requested region.");
      }
    }
    return raster;
  })();
  cache.set(key, { expires: Date.now() + 24 * 60 * 60 * 1000, result });
  try { return await result; }
  catch (error) {
    if (cache.get(key)?.result === result) cache.delete(key);
    throw new Error(`Could not retrieve raster from ${service}.`, { cause: error });
  }
}

export function rasterCell(raster: RasterGrid, point: dataBundle["location"]) {
  const { west, south, east, north } = raster.bounds;
  if (point.latitude < south || point.latitude > north || point.longitude < west || point.longitude > east) {
    throw new Error("Sample point is outside the raster extent.");
  }
  const column = Math.min(raster.width - 1, Math.floor((point.longitude - west) / (east - west) * raster.width));
  const row = Math.min(raster.height - 1, Math.floor((north - point.latitude) / (north - south) * raster.height));
  return { row, column, index: row * raster.width + column };
}
