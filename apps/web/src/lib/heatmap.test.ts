import { describe, expect, it } from "vitest";
import type { StateHeatmap } from "../api/types";
import { colourTable, heatmapSize, renderHeatmap, summarizeHeatmap } from "./heatmap";

const STOPS = [
  [0, "#000000"],
  [0.5, "#ff0000"],
  [1, "#ffffff"],
] as const;
const everywhere = () => true;
const pixel = (pixels: Uint8ClampedArray, width: number, x: number, y: number) =>
  Array.from(pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4));

describe("colourTable", () => {
  it("interpolates between stops and hits each stop exactly", () => {
    const table = colourTable(STOPS);
    const at = (i: number) => Array.from(table.slice(i * 3, i * 3 + 3));
    expect(at(0)).toEqual([0, 0, 0]);
    expect(at(255)).toEqual([255, 255, 255]);
    expect(at(64)[0]).toBeCloseTo(128, -1);
    expect(at(64).slice(1)).toEqual([0, 0]);
    expect(at(191)[1]).toBeCloseTo(128, -1);
  });
});

describe("heatmapSize", () => {
  it("keeps the on-screen aspect ratio and the size cap", () => {
    // Near the equator a square box in degrees is square on screen.
    const square = heatmapSize([-1, -1, 1, 1], 10);
    expect(square.width).toBe(256);
    expect(square.height).toBe(256);
    // Further north the same box is taller in Web Mercator.
    const north = heatmapSize([-100, 45, -98, 47], 10);
    expect(north.height / north.width).toBeCloseTo(1 / Math.cos((46 * Math.PI) / 180), 1);
    const wide = heatmapSize([-106, 26, -93, 36.5], 200);
    expect(wide.width).toBe(1024);
    const tall = heatmapSize([-80, 25, -79, 49], 200);
    expect(tall.height).toBe(1024);
    expect(tall.width).toBeLessThan(100);
  });
});

describe("renderHeatmap", () => {
  const bounds = [-1, -1, 1, 1] as [number, number, number, number];
  const size = { width: 40, height: 40 };

  it("interpolates between grid points and fades uncertain areas", () => {
    const grid = { rows: 1, columns: 2, spacingKm: 100, probability: [0, 1], uncertainty: [0, 1] };
    const pixels = renderHeatmap(grid, bounds, size, everywhere, STOPS);
    // West of the first cell centre the value is clamped to it: black, fully opaque.
    expect(pixel(pixels, 40, 2, 20)).toEqual([0, 0, 0, 255]);
    // East of the last centre: white, at the minimum opacity.
    expect(pixel(pixels, 40, 37, 20)).toEqual([255, 255, 255, 102]);
    // Halfway between: the middle stop.
    const [r, g, b, a] = pixel(pixels, 40, 20, 20);
    expect(r).toBeGreaterThan(240);
    expect(g).toBeLessThan(20);
    expect(b).toBeLessThan(20);
    expect(a).toBeGreaterThan(102);
    expect(a).toBeLessThan(255);
  });

  it("leaves pixels outside the area, or with no scored neighbour, transparent", () => {
    const grid = { rows: 1, columns: 4, spacingKm: 50, probability: [1, null, null, null], uncertainty: [0, null, null, null] };
    const east = (long: number) => long > -0.9;
    const pixels = renderHeatmap(grid, bounds, size, east, STOPS);
    expect(pixel(pixels, 40, 0, 20)[3]).toBe(0); // Outside the area.
    expect(pixel(pixels, 40, 5, 20)).toEqual([255, 255, 255, 255]); // Beside the scored point.
    // Between a scored and an unscored point the scored value carries over, undiluted.
    expect(pixel(pixels, 40, 12, 20)).toEqual([255, 255, 255, 255]);
    expect(pixel(pixels, 40, 30, 20)[3]).toBe(0); // No scored neighbour.
  });

  it("spaces rows in Web Mercator so the image lines up on the map", () => {
    // Two rows split at 50 N over 40 N to 60 N. In Mercator the 50 N line is
    // above the image's vertical middle.
    const grid = { rows: 2, columns: 1, spacingKm: 1000, probability: [1, 0], uncertainty: [0, 0] };
    const pixels = renderHeatmap(grid, [-1, 40, 1, 60], { width: 4, height: 200 }, everywhere, STOPS);
    // Green runs out exactly where the value falls to the middle stop: at 50 N.
    const boundary = Array.from({ length: 200 }, (_, y) => y).find((y) => pixel(pixels, 4, 2, y)[1] === 0);
    // 50 N is 55% of the way down in Mercator y, not 50%.
    expect(boundary).toBeGreaterThan(100);
    expect(boundary).toBeLessThan(120);
  });
});

describe("summarizeHeatmap", () => {
  const heatmap: StateHeatmap = {
    stateId: "08",
    status: "ready",
    bounds: [-110, 36, -100, 40],
    updatedAt: "2026-11-14T12:00:00Z",
    grid: { rows: 2, columns: 2, spacingKm: 200, probability: [0.2, 0.9, 0.6, null], uncertainty: [0.1, 0.1, 0.1, null] },
    detections: { type: "FeatureCollection", features: [] },
  };

  it("finds the peak, its location and the share of hot points", () => {
    expect(summarizeHeatmap(heatmap, everywhere)).toEqual({
      pointCount: 3,
      peak: 0.9,
      hotShare: 2 / 3,
      hottest: { lat: 39, long: -102.5 },
    });
  });

  it("counts only points inside the state, unless none are", () => {
    const west = (long: number) => long < -105;
    expect(summarizeHeatmap(heatmap, west)).toMatchObject({ pointCount: 2, peak: 0.6, hotShare: 0.5 });
    expect(summarizeHeatmap(heatmap, () => false)).toMatchObject({ pointCount: 3, peak: 0.9 });
  });

  it("is empty without a grid", () => {
    expect(summarizeHeatmap({ ...heatmap, status: "observed", grid: null }, everywhere)).toEqual({
      pointCount: 0,
      peak: null,
      hotShare: 0,
      hottest: null,
    });
  });
});
