// Small geometry helpers for state outlines. Coordinates are GeoJSON
// [long, lat] in EPSG:4326.
import type { MultiPolygon, Polygon, Position } from "geojson";

export type Area = Polygon | MultiPolygon;
export type Bounds = [west: number, south: number, east: number, north: number];

function polygons(geometry: Area): Position[][][] {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

export function geometryBounds(geometry: Area): Bounds {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const polygon of polygons(geometry)) {
    // The outer ring bounds the whole polygon.
    for (const [x, y] of polygon[0] ?? []) {
      if (x === undefined || y === undefined) continue;
      if (x < west) west = x;
      if (x > east) east = x;
      if (y < south) south = y;
      if (y > north) north = y;
    }
  }
  return [west, south, east, north];
}

/** Even-odd ray cast over every ring, so holes are excluded. */
function inRings(rings: Position[][], x: number, y: number): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] as Position as [number, number];
      const [xj, yj] = ring[j] as Position as [number, number];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

export function containsPoint(geometry: Area, long: number, lat: number): boolean {
  return polygons(geometry).some((rings) => inRings(rings, long, lat));
}

// Web Mercator in unit square, so scaling looks uniform on screen.
function toMercator([long, lat]: Position): [number, number] {
  const x = ((long ?? 0) + 180) / 360;
  const y =
    (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + ((lat ?? 0) * Math.PI) / 360))) /
    360;
  return [x, y];
}

function fromMercator(x: number, y: number): Position {
  const long = x * 360 - 180;
  const lat = (360 / Math.PI) * Math.atan(Math.exp(((180 - y * 360) * Math.PI) / 180)) - 90;
  return [long, lat];
}

/**
 * Scales a polygon about the centre of its bounding box, measured in Web
 * Mercator so the result looks like a uniform zoom of the shape on the map.
 */
export function scaleGeometry<T extends Area>(geometry: T, factor: number): T {
  const [west, south, east, north] = geometryBounds(geometry);
  const [x0, y0] = toMercator([west, north]);
  const [x1, y1] = toMercator([east, south]);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const scale = (p: Position): Position => {
    const [x, y] = toMercator(p);
    return fromMercator(cx + (x - cx) * factor, cy + (y - cy) * factor);
  };
  const scaled = polygons(geometry).map((rings) => rings.map((ring) => ring.map(scale)));
  return (
    geometry.type === "Polygon"
      ? { type: "Polygon", coordinates: scaled[0] ?? [] }
      : { type: "MultiPolygon", coordinates: scaled }
  ) as T;
}

/** Shoelace sum: positive for counter-clockwise rings. */
function signedArea(ring: Position[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi = 0, yi = 0] = ring[i] ?? [];
    const [xj = 0, yj = 0] = ring[j] ?? [];
    sum += (xj - xi) * (yj + yi);
  }
  return sum / 2;
}

function wound(ring: Position[], counterClockwise: boolean): Position[] {
  return signedArea(ring) > 0 === counterClockwise ? ring : [...ring].reverse();
}

/**
 * A world-sized polygon with the area cut out, used to dim everything but the
 * selected state. Winding follows RFC 7946 (outer CCW, holes CW), which
 * MapLibre needs to tell holes from outer rings.
 */
export function maskOutside(geometry: Area): Polygon {
  const world: Position[] = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ];
  const holes = polygons(geometry)
    .map((rings) => rings[0])
    .filter((ring): ring is Position[] => ring !== undefined)
    .map((ring) => wound(ring, false));
  return { type: "Polygon", coordinates: [wound(world, true), ...holes] };
}

/**
 * Point-in-area test for many points on shared latitudes (grid cell centres).
 * Edge crossings are computed once per latitude, so a grid of R rows and C
 * columns costs R x vertices rather than R x C x vertices.
 */
export function createPointTester(geometry: Area): (long: number, lat: number) => boolean {
  const rings = polygons(geometry).flat();
  const crossings = new Map<number, number[]>();
  const crossingsAt = (y: number): number[] => {
    let xs = crossings.get(y);
    if (xs) return xs;
    xs = [];
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi = 0, yi = 0] = ring[i] ?? [];
        const [xj = 0, yj = 0] = ring[j] ?? [];
        if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
      }
    }
    xs.sort((a, b) => a - b);
    crossings.set(y, xs);
    return xs;
  };
  return (long, lat) => {
    let inside = false;
    for (const x of crossingsAt(lat)) {
      if (x > long) break;
      inside = !inside;
    }
    return inside;
  };
}
