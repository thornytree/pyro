import { writeArrayBuffer } from "geotiff";
import type { BoundingBox } from "../../src/fan-out/types.ts";

/** Small synthetic, georeferenced numeric rasters; no external data required. */
export function rasterBytes(
  bounds: BoundingBox, width: number, height: number,
  value: number | ((row: number, column: number) => number),
): ArrayBuffer {
  const values = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      values[row * width + column] = typeof value === "number" ? value : value(row, column);
    }
  }
  return writeArrayBuffer(values, {
    width, height, GeographicTypeGeoKey: 4326, GTRasterTypeGeoKey: 1,
    ModelPixelScale: [(bounds.east - bounds.west) / width, (bounds.north - bounds.south) / height, 0],
    ModelTiepoint: [0, 0, 0, bounds.west, bounds.north, 0],
  });
}

export function rasterResponse(url: URL, value: number): Response {
  const [west, south, east, north] = url.searchParams.get("bbox")!.split(",").map(Number);
  const [width, height] = url.searchParams.get("size")!.split(",").map(Number);
  return new Response(rasterBytes({ west: west!, south: south!, east: east!, north: north! }, width!, height!, value));
}
