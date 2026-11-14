import { describe, expect, it } from "vitest";
import { buildMockTile } from "./mock";

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
    expect(tile.cells.features).toHaveLength(100);
    for (const { properties } of tile.cells.features) {
      expect(properties.probability).toBeGreaterThanOrEqual(0);
      expect(properties.probability).toBeLessThanOrEqual(1);
      expect(properties.uncertainty).toBeGreaterThanOrEqual(0);
      expect(properties.uncertainty).toBeLessThanOrEqual(1);
    }
    for (const { properties } of tile.detections.features) {
      expect(Date.parse(properties.acquiredAt)).toBeLessThanOrEqual(now.getTime());
    }
  });
});
