import type { MultiPolygon, Polygon } from "geojson";
import { describe, expect, it } from "vitest";
import {
  containsPoint,
  createPointTester,
  geometryBounds,
  maskOutside,
  scaleGeometry,
} from "./geo";

// 10 x 10 square with a 2 x 2 hole in the middle.
const donut: Polygon = {
  type: "Polygon",
  coordinates: [
    [[-110, 30], [-100, 30], [-100, 40], [-110, 40], [-110, 30]],
    [[-106, 34], [-104, 34], [-104, 36], [-106, 36], [-106, 34]],
  ],
};
const islands: MultiPolygon = {
  type: "MultiPolygon",
  coordinates: [
    [[[-90, 30], [-89, 30], [-89, 31], [-90, 31], [-90, 30]]],
    [[[-80, 40], [-79, 40], [-79, 41], [-80, 41], [-80, 40]]],
  ],
};

const signedArea = (ring: number[][]) =>
  ring.reduce((sum, [x = 0, y = 0], i) => {
    const [nx = 0, ny = 0] = ring[(i + 1) % ring.length] ?? [];
    return sum + (x * ny - nx * y);
  }, 0) / 2;

describe("geometryBounds", () => {
  it("covers every polygon", () => {
    expect(geometryBounds(donut)).toEqual([-110, 30, -100, 40]);
    expect(geometryBounds(islands)).toEqual([-90, 30, -79, 41]);
  });
});

describe("containsPoint", () => {
  it("excludes holes and handles multipolygons", () => {
    expect(containsPoint(donut, -108, 32)).toBe(true);
    expect(containsPoint(donut, -105, 35)).toBe(false);
    expect(containsPoint(donut, -95, 35)).toBe(false);
    expect(containsPoint(islands, -79.5, 40.5)).toBe(true);
    expect(containsPoint(islands, -85, 35)).toBe(false);
  });
});

describe("scaleGeometry", () => {
  it("keeps the shape centred and grows it", () => {
    const scaled = scaleGeometry(donut, 1.1);
    const [w, s, e, n] = geometryBounds(scaled);
    expect(e - w).toBeCloseTo(11, 6);
    // Mercator stretches north more than south, so the box grows past 11.
    expect(n - s).toBeGreaterThan(10);
    expect((w + e) / 2).toBeCloseTo(-105, 6);
    expect(containsPoint(scaled, -105, 35)).toBe(false);
  });

  it("is the identity at factor 1 and keeps the geometry type", () => {
    const same = scaleGeometry(islands, 1);
    expect(same.type).toBe("MultiPolygon");
    same.coordinates.flat(2).forEach(([x, y], i) => {
      const [ox, oy] = islands.coordinates.flat(2)[i] ?? [];
      expect(x).toBeCloseTo(ox ?? NaN, 9);
      expect(y).toBeCloseTo(oy ?? NaN, 9);
    });
  });
});

describe("maskOutside", () => {
  it("cuts each polygon out of a world ring with RFC 7946 winding", () => {
    const mask = maskOutside(islands);
    expect(mask.coordinates).toHaveLength(3);
    const [outer, ...holes] = mask.coordinates;
    expect(signedArea(outer ?? [])).toBeGreaterThan(0);
    for (const hole of holes) expect(signedArea(hole)).toBeLessThan(0);
    expect(containsPoint(mask, -89.5, 30.5)).toBe(false);
    expect(containsPoint(mask, 0, 0)).toBe(true);
  });
});

describe("createPointTester", () => {
  it("agrees with containsPoint", () => {
    for (const geometry of [donut, islands]) {
      const test = createPointTester(geometry);
      for (let long = -112; long <= -77; long += 0.37) {
        for (let lat = 28; lat <= 42; lat += 0.29) {
          expect(test(long, lat)).toBe(containsPoint(geometry, long, lat));
        }
      }
    }
  });
});
