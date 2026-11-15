import { describe, expect, it } from "vitest";
import { conusStates } from "../lib/states";
import { EXTREME_PROBABILITY, kmToMiles } from "../lib/spread";
import { buildMockStatePreview, buildMockTile, CELLS_PER_SIDE, MAX_HEAD_KM, mockRateKmh } from "./mock";

const now = new Date("2026-11-14T12:00:00Z");

describe("buildMockTile", () => {
  it("is deterministic for points in the same tile", () => {
    const a = buildMockTile({ lat: 39.51, long: -121.49 }, now);
    const b = buildMockTile({ lat: 39.99, long: -121.01 }, now);
    expect(b).toEqual(a);
  });

  it("gives different tiles different IDs", () => {
    const a = buildMockTile({ lat: 39.6, long: -121.4 }, now);
    const b = buildMockTile({ lat: 40.1, long: -121.4 }, now);
    expect(b.tileId).not.toBe(a.tileId);
  });

  it("contains the requested point and keeps values in range", () => {
    const point = { lat: 34.27, long: -118.73 };
    const tile = buildMockTile(point, now);
    const [west, south, east, north] = tile.bounds;

    expect(point.long).toBeGreaterThanOrEqual(west);
    expect(point.long).toBeLessThan(east);
    expect(point.lat).toBeGreaterThanOrEqual(south);
    expect(point.lat).toBeLessThan(north);
    expect(tile.cells.features).toHaveLength(CELLS_PER_SIDE ** 2);
    for (const { properties } of tile.cells.features) {
      expect(properties.probability).toBeGreaterThanOrEqual(0);
      expect(properties.probability).toBeLessThanOrEqual(1);
      expect(properties.uncertainty).toBeGreaterThanOrEqual(0);
      expect(properties.uncertainty).toBeLessThanOrEqual(1);
    }
    for (const { properties, geometry } of tile.detections.features) {
      expect(Date.parse(properties.acquiredAt)).toBeLessThanOrEqual(now.getTime());
      const [long = 0, lat = 0] = geometry.coordinates;
      expect(long).toBeGreaterThanOrEqual(west);
      expect(long).toBeLessThanOrEqual(east);
      expect(lat).toBeGreaterThanOrEqual(south);
      expect(lat).toBeLessThanOrEqual(north);
    }
  });
});

describe("resolution", () => {
  it("uses cells of about a kilometre (under a mile)", () => {
    const tile = buildMockTile({ lat: 39.5, long: -121.5 }, now);
    const ring = tile.cells.features[0]?.geometry.coordinates[0] ?? [];
    const heightKm = ((ring[2]?.[1] ?? 0) - (ring[0]?.[1] ?? 0)) * 111.32;
    expect(heightKm).toBeGreaterThan(0.5);
    expect(kmToMiles(heightKm)).toBeLessThan(1);
  });
});

/** Scans tiles along a line until one matches. Deterministic, so the result is stable. */
function findTile(predicate: (t: ReturnType<typeof buildMockTile>) => boolean, mode?: Parameters<typeof buildMockTile>[2]) {
  for (let i = 0; i < 400; i++) {
    const tile = buildMockTile({ lat: 34 + (i % 20) * 0.5, long: -122 + Math.floor(i / 20) * 0.5 }, now, mode);
    if (predicate(tile)) return tile;
  }
  throw new Error("no matching mock tile");
}

describe("live spread", () => {
  it("predicts spread only where a cell is extreme, within single-digit miles", () => {
    const hot = findTile((t) => (t.spread?.features.length ?? 0) > 0);
    const extreme = hot.cells.features.filter((f) => f.properties.probability >= EXTREME_PROBABILITY);
    expect(extreme.length).toBeGreaterThan(0);
    expect(hot.drivers).not.toBeNull();
    const horizons = hot.spread?.features.map((f) => f.properties.horizonHours);
    expect(horizons).toEqual([24, 12, 6]);
    const heads = hot.spread?.features.map((f) => f.properties.headKm) ?? [];
    // Longer horizons reach further (or hit the cap), and never past 9 miles.
    expect(heads[0]).toBeGreaterThanOrEqual(heads[1] ?? 0);
    expect(heads[1]).toBeGreaterThanOrEqual(heads[2] ?? 0);
    for (const km of heads) expect(kmToMiles(km)).toBeLessThan(10);
    // Each horizon runs rate x hours past the edge, up to the cap.
    for (const { properties: z } of hot.spread?.features ?? []) {
      expect(z.headKm).toBeCloseTo(Math.min(MAX_HEAD_KM, z.rateKmh * z.horizonHours), 6);
    }
    expect(MAX_HEAD_KM).toBeLessThan(10 * 1.609344);

    const calm = findTile((t) => t.cells.features.every((f) => f.properties.probability < EXTREME_PROBABILITY));
    expect(calm.spread?.features).toHaveLength(0);
  });

  it("spreads faster in wind and dry air", () => {
    const base = mockRateKmh({ windSpeedKmh: 10, relativeHumidityPct: 30 });
    expect(mockRateKmh({ windSpeedKmh: 40, relativeHumidityPct: 30 })).toBeGreaterThan(base);
    expect(mockRateKmh({ windSpeedKmh: 10, relativeHumidityPct: 10 })).toBeGreaterThan(base);
  });
});

describe("historical tiles", () => {
  const day = (date: string) => ({ kind: "historical", date }) as const;

  it("vary by day, age detections from the end of that day and carry no spread", () => {
    const point = { lat: 39.6, long: -121.4 };
    const a = buildMockTile(point, now, day("2021-08-20"));
    const b = buildMockTile(point, now, day("2021-08-21"));
    expect(a.tileId).toBe(b.tileId);
    expect(a.cells).not.toEqual(b.cells);
    expect(buildMockTile(point, now, day("2021-08-20"))).toEqual(a);
    expect(a.spread).toBeUndefined();
    for (const { properties } of a.detections.features) {
      const t = Date.parse(properties.acquiredAt);
      expect(t).toBeGreaterThanOrEqual(Date.parse("2021-08-20T00:00:00Z"));
      expect(t).toBeLessThanOrEqual(Date.parse("2021-08-20T23:59:59Z"));
    }
  });

  it("has perimeters only in the western US from 2020 to 2024", () => {
    const west = findTile((t) => (t.perimeters?.features.length ?? 0) > 0, day("2021-08-20"));
    expect(west.perimeters?.features[0]?.properties.date).toBe("2021-08-20");
    expect(west.bounds[2]).toBeLessThanOrEqual(-102);

    const before = buildMockTile({ lat: (west.bounds[1] + west.bounds[3]) / 2, long: (west.bounds[0] + west.bounds[2]) / 2 }, now, day("2015-08-20"));
    expect(before.perimeters?.features).toHaveLength(0);
    const east = buildMockTile({ lat: 35.2, long: -80.2 }, now, day("2021-08-20"));
    expect(east.perimeters?.features).toHaveLength(0);
  });
});

describe("buildMockStatePreview", () => {
  const states = conusStates();
  const byName = (name: string) => {
    const state = states.find((s) => s.properties.name === name);
    if (!state) throw new Error(name);
    return state;
  };

  it("only includes tiles that overlap the state, with values in range", () => {
    const colorado = byName("Colorado");
    const preview = buildMockStatePreview(colorado, now);
    expect(preview.stateId).toBe("08");
    // Colorado is about 7 x 4 degrees: 14 x 8 half-degree tiles, plus edges.
    expect(preview.tiles.features.length).toBeGreaterThanOrEqual(112);
    expect(preview.tiles.features.length).toBeLessThanOrEqual(135);
    for (const { properties } of preview.tiles.features) {
      expect(properties.peakProbability).toBeGreaterThanOrEqual(0);
      expect(properties.peakProbability).toBeLessThanOrEqual(1);
    }
  });

  it("agrees with the full tile for an interior tile", () => {
    const point = { lat: 39.25, long: -105.75 };
    const tile = buildMockTile(point, now);
    const preview = buildMockStatePreview(byName("Colorado"), now);
    const coarse = preview.tiles.features.find((f) => f.properties.tileId === tile.tileId);
    const peak = Math.max(...tile.cells.features.map((f) => f.properties.probability));
    expect(coarse?.properties.peakProbability).toBe(peak);
  });

  it("agrees with the full tile in historical mode", () => {
    const point = { lat: 39.25, long: -105.75 };
    const mode = { kind: "historical", date: "2021-08-20" } as const;
    const tile = buildMockTile(point, now, mode);
    const preview = buildMockStatePreview(byName("Colorado"), now, mode);
    const coarse = preview.tiles.features.find((f) => f.properties.tileId === tile.tileId);
    const peak = Math.max(...tile.cells.features.map((f) => f.properties.probability));
    expect(coarse?.properties.peakProbability).toBe(peak);
  });

  it("finds tiles for a very small area", () => {
    expect(buildMockStatePreview(byName("District of Columbia"), now).tiles.features.length).toBeGreaterThan(0);
  });

  it("is quick enough for the largest state", () => {
    const start = performance.now();
    buildMockStatePreview(byName("Texas"), now);
    expect(performance.now() - start).toBeLessThan(250);
  });
});
