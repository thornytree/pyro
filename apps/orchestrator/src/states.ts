// CONUS state outlines (us-atlas, US Census Bureau 1:10m), the same file the web
// app bundles, so both sides agree on where a state ends.
import { createRequire } from "node:module";
import type { MultiPolygon, Polygon, Position } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { BoundingBox } from "./fan-out/types.ts";

type Area = Polygon | MultiPolygon;
export type StateOutline = {
  fips: string;
  name: string;
  bounds: BoundingBox;
  areaKm2: number;
  /** Even-odd test over every ring, so holes are excluded. */
  contains: (latitude: number, longitude: number) => boolean;
};

/** Alaska, Hawaii and the territories are outside the supported area. */
const NON_CONUS_FIPS = new Set(["02", "15", "60", "66", "69", "72", "78"]);
export const KM_PER_DEGREE = 6371.0088 * Math.PI / 180;

function outline(fips: string, name: string, geometry: Area): StateOutline {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const rings = polygons.flat();
  const bounds = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
  for (const [x, y] of rings.flat() as Array<[number, number]>) {
    bounds.west = Math.min(bounds.west, x); bounds.east = Math.max(bounds.east, x);
    bounds.south = Math.min(bounds.south, y); bounds.north = Math.max(bounds.north, y);
  }
  // Shoelace on a local equirectangular plane; within about 1% at state scale.
  const scale = Math.cos((bounds.south + bounds.north) / 2 * Math.PI / 180);
  const ringArea = (ring: Position[]) => {
    let sum = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      sum += (ring[j]![0]! - ring[i]![0]!) * (ring[j]![1]! + ring[i]![1]!);
    }
    return Math.abs(sum) / 2 * scale * KM_PER_DEGREE ** 2;
  };
  const areaKm2 = polygons.reduce((total, [outer, ...holes]) =>
    total + ringArea(outer ?? []) - holes.reduce((sum, hole) => sum + ringArea(hole), 0), 0);
  const contains = (latitude: number, longitude: number) => {
    if (latitude < bounds.south || latitude > bounds.north || longitude < bounds.west || longitude > bounds.east) return false;
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i] as [number, number];
        const [xj, yj] = ring[j] as [number, number];
        if (yi > latitude !== yj > latitude && longitude < (xj - xi) * (latitude - yi) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  };
  return { fips, name, bounds, areaKm2, contains };
}

let cache: Map<string, StateOutline> | null = null;

function outlines(): Map<string, StateOutline> {
  if (cache) return cache;
  const topology = createRequire(import.meta.url)("us-atlas/states-10m.json") as Topology;
  const collection = feature(topology, topology.objects.states as GeometryCollection<{ name: string }>);
  cache = new Map();
  for (const state of collection.features) {
    const fips = String(state.id);
    const type = state.geometry.type;
    if (NON_CONUS_FIPS.has(fips) || (type !== "Polygon" && type !== "MultiPolygon")) continue;
    cache.set(fips, outline(fips, state.properties.name, state.geometry as Area));
  }
  return cache;
}

/** The outline for a two-digit CONUS state FIPS code, e.g. "06". */
export function stateOutline(fips: string): StateOutline | undefined {
  return outlines().get(fips);
}
