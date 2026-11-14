// Project grid: fixed 50 km tiles over CONUS in EPSG:5070 (NAD83 / CONUS Albers).
// Port of apps/inference/shared/grid.py. The constants and tile IDs must stay
// identical to the Python version, so change both together.

import type { BoundingBox, LatLon } from "./types.ts";

// GRS80 ellipsoid
const A = 6378137.0;
const F = 1 / 298.257222101;
const E2 = F * (2 - F);
const E = Math.sqrt(E2);

// EPSG:5070 parameters
const LAT_1 = 29.5, LAT_2 = 45.5, LAT_0 = 23.0, LON_0 = -96.0;

export const TILE_SIZE_M = 50_000;
export const X_MIN = -2_400_000, Y_MIN = 250_000;
export const N_COLS = 95, N_ROWS = 59;

const rad = (deg: number) => deg * Math.PI / 180;
const deg = (r: number) => r * 180 / Math.PI;

function q(sinLat: number): number {
  return (1 - E2) * (sinLat / (1 - E2 * sinLat ** 2) -
    Math.log((1 - E * sinLat) / (1 + E * sinLat)) / (2 * E));
}
function m(latRad: number): number {
  return Math.cos(latRad) / Math.sqrt(1 - E2 * Math.sin(latRad) ** 2);
}

const Q1 = q(Math.sin(rad(LAT_1))), Q2 = q(Math.sin(rad(LAT_2))), Q0 = q(Math.sin(rad(LAT_0)));
const M1 = m(rad(LAT_1)), M2 = m(rad(LAT_2));
const N = (M1 ** 2 - M2 ** 2) / (Q2 - Q1);
const C = M1 ** 2 + N * Q1;
const RHO_0 = A * Math.sqrt(C - N * Q0) / N;

/** Degrees to EPSG:5070 metres. */
export function toAlbers(latitude: number, longitude: number): { x: number; y: number } {
  const dlon = ((longitude - LON_0 + 180) % 360 + 360) % 360 - 180;
  const rho = A * Math.sqrt(C - N * q(Math.sin(rad(latitude)))) / N;
  const theta = N * rad(dlon);
  return { x: rho * Math.sin(theta), y: RHO_0 - rho * Math.cos(theta) };
}

/** EPSG:5070 metres to degrees (Snyder's iterative inverse). */
export function fromAlbers(x: number, y: number): LatLon {
  const rho = Math.hypot(x, RHO_0 - y);
  const theta = Math.atan2(x, RHO_0 - y);
  const qv = (C - (rho * N / A) ** 2) / N;
  let phi = Math.asin(qv / 2);
  for (let i = 0; i < 15; i++) {
    const s = Math.sin(phi);
    const step = (1 - E2 * s * s) ** 2 / (2 * Math.cos(phi)) *
      (qv / (1 - E2) - s / (1 - E2 * s * s) + Math.log((1 - E * s) / (1 + E * s)) / (2 * E));
    phi += step;
    if (Math.abs(step) < 1e-12) break;
  }
  return { latitude: deg(phi), longitude: LON_0 + deg(theta / N) };
}

export type TileIndex = { row: number; col: number };

/** Row 0 is the southernmost row. Returns null outside the CONUS frame. */
export function tileIndexAt(latitude: number, longitude: number): TileIndex | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const { x, y } = toAlbers(latitude, longitude);
  const col = Math.floor((x - X_MIN) / TILE_SIZE_M);
  const row = Math.floor((y - Y_MIN) / TILE_SIZE_M);
  if (col < 0 || col >= N_COLS || row < 0 || row >= N_ROWS) return null;
  return { row, col };
}

/** The shareable location ID, e.g. "r12c34". */
export function tileId({ row, col }: TileIndex): string {
  return `r${String(row).padStart(2, "0")}c${String(col).padStart(2, "0")}`;
}

export function tileIdAt(latitude: number, longitude: number): string | null {
  const index = tileIndexAt(latitude, longitude);
  return index ? tileId(index) : null;
}

export function parseTileId(id: string): TileIndex {
  const match = /^r(\d{2,})c(\d{2,})$/.exec(id);
  const row = Number(match?.[1]), col = Number(match?.[2]);
  if (!match || row >= N_ROWS || col >= N_COLS) throw new Error(`Invalid tile ID: ${id}`);
  return { row, col };
}

/** Points on a regular grid inside the tile, `spacingM` apart, centred in their cells. */
export function tileSamplePoints(id: string, spacingM = 10_000): LatLon[] {
  const { row, col } = parseTileId(id);
  const x0 = X_MIN + col * TILE_SIZE_M, y0 = Y_MIN + row * TILE_SIZE_M;
  const steps = Math.round(TILE_SIZE_M / spacingM);
  const points: LatLon[] = [];
  for (let j = 0; j < steps; j++) {
    for (let i = 0; i < steps; i++) {
      points.push(fromAlbers(x0 + (i + 0.5) * spacingM, y0 + (j + 0.5) * spacingM));
    }
  }
  return points;
}

/** Lat/long box enclosing the whole tile frame, sampled along its edges. */
export function frameBounds(): BoundingBox {
  const b = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
  const xMax = X_MIN + N_COLS * TILE_SIZE_M, yMax = Y_MIN + N_ROWS * TILE_SIZE_M;
  for (let t = 0; t <= 100; t++) {
    const x = X_MIN + (xMax - X_MIN) * t / 100, y = Y_MIN + (yMax - Y_MIN) * t / 100;
    for (const p of [fromAlbers(x, Y_MIN), fromAlbers(x, yMax), fromAlbers(X_MIN, y), fromAlbers(xMax, y)]) {
      b.west = Math.min(b.west, p.longitude); b.east = Math.max(b.east, p.longitude);
      b.south = Math.min(b.south, p.latitude); b.north = Math.max(b.north, p.latitude);
    }
  }
  const round = (v: number, up: boolean) => (up ? Math.ceil(v * 100) : Math.floor(v * 100)) / 100;
  return { west: round(b.west, false), south: round(b.south, false), east: round(b.east, true), north: round(b.north, true) };
}
