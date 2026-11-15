import { describe, expect, it } from "vitest";
import { regionBounds, snapToRegion } from "./region";

describe("regionBounds", () => {
  it("matches the orchestrator's 300-square-mile box", () => {
    const [west, south, east, north] = regionBounds({ lat: 34.05, long: -118.25 });
    const heightKm = (north - south) * 111.195;
    const widthKm = (east - west) * 111.195 * Math.cos((34.05 * Math.PI) / 180);
    expect(heightKm * widthKm).toBeCloseTo(300 * 1.609344 ** 2, 0);
    expect((west + east) / 2).toBeCloseTo(-118.25, 9);
    expect((south + north) / 2).toBeCloseTo(34.05, 9);
  });
});

describe("snapToRegion", () => {
  it("gives every point in a tile the same centre, and the tile holds the point", () => {
    const point = { lat: 39.123, long: -121.456 };
    const centre = snapToRegion(point);
    const [west, south, east, north] = regionBounds(centre);
    expect(point.long).toBeGreaterThanOrEqual(west);
    expect(point.long).toBeLessThanOrEqual(east);
    expect(point.lat).toBeGreaterThanOrEqual(south);
    expect(point.lat).toBeLessThanOrEqual(north);
    expect(snapToRegion({ lat: (south + north) / 2 + 0.01, long: (west + east) / 2 - 0.01 })).toEqual(centre);
    expect(snapToRegion(centre)).toEqual(centre);
  });

  it("never moves a point out of the supported area", () => {
    for (const long of [-124.99, -100, -66.91]) {
      for (const lat of [24.41, 37, 49.39]) {
        const { lat: y, long: x } = snapToRegion({ lat, long });
        expect(y).toBeGreaterThanOrEqual(24.4);
        expect(y).toBeLessThanOrEqual(49.4);
        expect(x).toBeGreaterThanOrEqual(-125);
        expect(x).toBeLessThanOrEqual(-66.9);
      }
    }
  });
});
