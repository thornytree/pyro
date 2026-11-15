// Statewide heat map: turns a coarse grid of scores into one RGBA image that
// MapLibre stretches over the state. Kept free of DOM and map types so it can
// be unit tested.
import type { StateHeatmap, StateHeatmapGrid } from "../api/types";
import type { Bounds } from "./geo";

export type ColourStops = ReadonlyArray<readonly [number, string]>;
type PointTest = (long: number, lat: number) => boolean;

/** Per-pixel opacity at uncertainty 0 and 1: less certain areas are fainter. */
const ALPHA = { certain: 1, uncertain: 0.4 };
const RAD = Math.PI / 180;

/** Web Mercator y in radians (north positive). An image source is stretched linearly in this space. */
const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
const latitudeAt = (y: number) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / RAD;

/**
 * Image size for a grid: several pixels per scored point so the interpolation
 * and the state border look smooth, with the on-screen (Mercator) aspect ratio.
 */
export function heatmapSize(
  bounds: Bounds,
  columns: number,
  maxSide = 1024,
): { width: number; height: number } {
  const [west, south, east, north] = bounds;
  const aspect = (mercatorY(north) - mercatorY(south)) / ((east - west) * RAD);
  let width = Math.min(maxSide, Math.max(256, columns * 12));
  let height = width * aspect;
  if (height > maxSide) {
    width *= maxSide / height;
    height = maxSide;
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

const hex = (colour: string, offset: number) => parseInt(colour.slice(offset, offset + 2), 16);

/** 256 RGB triples sampled along a ramp of `#rrggbb` stops over 0 to 1. */
export function colourTable(stops: ColourStops): Uint8Array {
  const table = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const value = i / 255;
    const upper = Math.max(1, stops.findIndex(([stop]) => stop >= value));
    const [from, fromColour] = stops[upper - 1] ?? [0, "#000000"];
    const [to, toColour] = stops[upper] ?? [1, fromColour];
    const t = to > from ? Math.min(1, Math.max(0, (value - from) / (to - from))) : 0;
    for (let channel = 0; channel < 3; channel++) {
      const a = hex(fromColour, 1 + channel * 2);
      table[i * 3 + channel] = Math.round(a + (hex(toColour, 1 + channel * 2) - a) * t);
    }
  }
  return table;
}

/**
 * RGBA pixels, row-major from the north-west corner. Scores are bilinearly
 * interpolated between grid points (ignoring missing ones); pixels outside
 * `isInside`, or with no scored neighbour, are transparent. Rows are evenly
 * spaced in Web Mercator, so the image lines up when MapLibre stretches it
 * between the bounds' corners.
 */
export function renderHeatmap(
  grid: StateHeatmapGrid,
  bounds: Bounds,
  { width, height }: { width: number; height: number },
  isInside: PointTest,
  stops: ColourStops,
): Uint8ClampedArray<ArrayBuffer> {
  const { rows, columns, probability, uncertainty } = grid;
  const [west, south, east, north] = bounds;
  const table = colourTable(stops);
  const pixels = new Uint8ClampedArray(width * height * 4);
  const top = mercatorY(north);
  const bottom = mercatorY(south);

  for (let py = 0; py < height; py++) {
    const lat = latitudeAt(top + ((py + 0.5) / height) * (bottom - top));
    // Position in grid units, where cell centres sit on whole numbers.
    const gy = ((north - lat) / (north - south)) * rows - 0.5;
    const y0 = Math.floor(gy);
    const ty = gy - y0;
    for (let px = 0; px < width; px++) {
      const long = west + ((px + 0.5) / width) * (east - west);
      if (!isInside(long, lat)) continue;
      const gx = ((px + 0.5) / width) * columns - 0.5;
      const x0 = Math.floor(gx);
      const tx = gx - x0;
      let weight = 0;
      let p = 0;
      let u = 0;
      for (let corner = 0; corner < 4; corner++) {
        const dx = corner & 1;
        const dy = corner >> 1;
        const column = Math.min(columns - 1, Math.max(0, x0 + dx));
        const row = Math.min(rows - 1, Math.max(0, y0 + dy));
        const value = probability[row * columns + column];
        if (value === null || value === undefined) continue;
        const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty);
        weight += w;
        p += w * value;
        u += w * (uncertainty[row * columns + column] ?? 1);
      }
      if (weight < 1e-6) continue;
      const colour = Math.round(Math.min(1, Math.max(0, p / weight)) * 255) * 3;
      const i = (py * width + px) * 4;
      pixels[i] = table[colour] ?? 0;
      pixels[i + 1] = table[colour + 1] ?? 0;
      pixels[i + 2] = table[colour + 2] ?? 0;
      pixels[i + 3] = 255 * (ALPHA.certain + (ALPHA.uncertain - ALPHA.certain) * (u / weight));
    }
  }
  return pixels;
}

export interface HeatmapSummary {
  /** Scored points inside the state. */
  pointCount: number;
  peak: number | null;
  /** Share of those points at or above `threshold`, 0 to 1. */
  hotShare: number;
  /** The highest-scoring point, to jump to it. */
  hottest: { lat: number; long: number } | null;
}

export function summarizeHeatmap(
  heatmap: StateHeatmap,
  isInside: PointTest,
  threshold = 0.5,
): HeatmapSummary {
  const empty: HeatmapSummary = { pointCount: 0, peak: null, hotShare: 0, hottest: null };
  const grid = heatmap.grid;
  if (!grid) return empty;
  const [west, south, east, north] = heatmap.bounds;
  const scan = (test: PointTest): HeatmapSummary => {
    let pointCount = 0;
    let hot = 0;
    let peak: number | null = null;
    let hottest: HeatmapSummary["hottest"] = null;
    for (let row = 0; row < grid.rows; row++) {
      const lat = north - ((row + 0.5) * (north - south)) / grid.rows;
      for (let column = 0; column < grid.columns; column++) {
        const value = grid.probability[row * grid.columns + column];
        const long = west + ((column + 0.5) * (east - west)) / grid.columns;
        if (value === null || value === undefined || !test(long, lat)) continue;
        pointCount++;
        if (value >= threshold) hot++;
        if (peak === null || value > peak) {
          peak = value;
          hottest = { lat, long };
        }
      }
    }
    return { pointCount, peak, hotShare: pointCount ? hot / pointCount : 0, hottest };
  };
  const inState = scan(isInside);
  // A state smaller than one grid cell may contain no cell centre.
  return inState.pointCount > 0 ? inState : scan(() => true);
}
