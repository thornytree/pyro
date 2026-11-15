import { describe, expect, it } from "vitest";
import { LIVE } from "../lib/mode";
import { conusStates, stateAt } from "../lib/states";
import { EXTREME_PROBABILITY, kmToMiles } from "../lib/spread";
import { buildMockStateHeatmap, buildMockTile, CELLS_PER_SIDE, MAX_HEAD_KM, mockRateKmh } from "./mock";

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

describe("buildMockStateHeatmap", () => {
  const states = conusStates();
  const byName = (name: string) => {
    const state = states.find((s) => s.properties.name === name);
    if (!state) throw new Error(name);
    return state;
  };

  it("covers the state's bounding box with values in range and gaps outside the state", () => {
    const colorado = byName("Colorado");
    const heatmap = buildMockStateHeatmap(colorado, now);
    expect(heatmap.stateId).toBe("08");
    expect(heatmap.status).toBe("ready");
    const grid = heatmap.grid!;
    // Colorado is about 7 x 4 degrees: 140 x 80 blocks of 0.05 degrees.
    expect(grid.columns).toBeGreaterThanOrEqual(140);
    expect(grid.rows).toBeGreaterThanOrEqual(80);
    expect(grid.probability).toHaveLength(grid.rows * grid.columns);
    expect(grid.uncertainty).toHaveLength(grid.rows * grid.columns);
    for (const value of grid.probability) {
      if (value !== null) expect(value >= 0 && value <= 1).toBe(true);
    }
    // Colorado fills its box; Florida leaves most of its box as sea.
    expect(grid.probability.filter((v) => v === null).length).toBeLessThan(0.1 * grid.probability.length);
    const florida = buildMockStateHeatmap(byName("Florida"), now).grid!;
    expect(florida.probability.filter((v) => v === null).length).toBeGreaterThan(0.4 * florida.probability.length);
  });

  it.each([LIVE, { kind: "historical", date: "2021-08-20" } as const])(
    "agrees with the full tile ($kind)",
    (mode) => {
      const point = { lat: 39.25, long: -105.75 };
      const tile = buildMockTile(point, now, mode);
      const heatmap = buildMockStateHeatmap(byName("Colorado"), now, mode);
      const grid = heatmap.grid!;
      const [west, , , north] = heatmap.bounds;
      // The block holding the tile's south-west corner: the mean of its 5 x 5 cells.
      const column = Math.round((tile.bounds[0] - west) / 0.05);
      const row = Math.round((north - tile.bounds[1]) / 0.05) - 1;
      const cells = tile.cells.features.filter(({ geometry }) => {
        const [long = 0, lat = 0] = geometry.coordinates[0]?.[0] ?? [];
        return long < tile.bounds[0] + 0.0499 && lat < tile.bounds[1] + 0.0499;
      });
      expect(cells).toHaveLength(25);
      const mean = cells.reduce((sum, f) => sum + f.properties.probability, 0) / 25;
      expect(grid.probability[row * grid.columns + column]).toBeCloseTo(mean, 10);
    },
  );

  it("differs between days and puts detections inside the state", () => {
    const texas = byName("Texas");
    const first = buildMockStateHeatmap(texas, now, { kind: "historical", date: "2021-08-20" });
    const second = buildMockStateHeatmap(texas, now, { kind: "historical", date: "2021-08-21" });
    expect(first.grid!.probability).not.toEqual(second.grid!.probability);
    expect(first.detections.features.length).toBeGreaterThan(0);
    for (const { geometry } of first.detections.features) {
      expect(stateAt(states, geometry.coordinates[1] ?? 0, geometry.coordinates[0] ?? 0)).toBe(texas);
    }
  });

  it("has values for a very small area", () => {
    const grid = buildMockStateHeatmap(byName("District of Columbia"), now).grid!;
    expect(grid.probability.some((v) => v !== null)).toBe(true);
  });

  it("is quick enough for the largest state", () => {
    const start = performance.now();
    buildMockStateHeatmap(byName("Texas"), now);
    expect(performance.now() - start).toBeLessThan(400);
  });
});
