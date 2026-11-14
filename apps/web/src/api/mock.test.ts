import { describe, expect, it } from "vitest";
import { conusStates } from "../lib/states";
import { buildMockStatePreview, buildMockTile } from "./mock";

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

  it("finds tiles for a very small area", () => {
    expect(buildMockStatePreview(byName("District of Columbia"), now).tiles.features.length).toBeGreaterThan(0);
  });

  it("is quick enough for the largest state", () => {
    const start = performance.now();
    buildMockStatePreview(byName("Texas"), now);
    expect(performance.now() - start).toBeLessThan(250);
  });
});
