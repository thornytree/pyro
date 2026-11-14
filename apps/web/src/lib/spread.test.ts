import { describe, expect, it } from "vitest";
import type { Position } from "geojson";
import {
  compassPoint,
  headingFromWind,
  kmToMiles,
  lengthToBreadth,
  offset,
  spreadArrow,
  spreadEllipse,
} from "./spread";

/** Great-circle distance in km. */
function distanceKm([x1 = 0, y1 = 0]: Position, [x2 = 0, y2 = 0]: Position): number {
  const r = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(y2 - y1);
  const dLong = toRad(x2 - x1);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(y1)) * Math.cos(toRad(y2)) * Math.sin(dLong / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

describe("headingFromWind", () => {
  it("points downwind", () => {
    expect(headingFromWind(225)).toBe(45); // SW wind drives the fire NE
    expect(headingFromWind(0)).toBe(180);
    expect(headingFromWind(-90)).toBe(90);
  });
});

describe("lengthToBreadth", () => {
  it("is a circle in calm air and stretches with wind, capped at 8", () => {
    expect(lengthToBreadth(0)).toBeCloseTo(1, 2);
    expect(lengthToBreadth(30)).toBeGreaterThan(lengthToBreadth(10));
    expect(lengthToBreadth(500)).toBe(8);
  });
});

describe("offset", () => {
  it("moves the right distance and direction", () => {
    const origin = [-120, 39];
    const east = offset(origin, 90, 10);
    expect(distanceKm(origin, east)).toBeCloseTo(10, 1);
    expect(east[1]).toBeCloseTo(39, 6);
    expect((east[0] ?? 0) > -120).toBe(true);
  });
});

describe("spreadEllipse", () => {
  const origin = [-120, 39];

  it("puts the head fire headKm downwind and the backing fire closer", () => {
    const ring = spreadEllipse({ origin, headingDeg: 45, headKm: 8, lb: 3 });
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    const distances = ring.map((p) => distanceKm(origin, p));
    // Vertex 0 is the head; vertex n/2 is the back.
    expect(distances[0]).toBeCloseTo(8, 1);
    const back = distances[24] ?? 0;
    expect(back).toBeGreaterThan(0);
    expect(back).toBeLessThan(2);
    expect(Math.max(...distances)).toBeCloseTo(8, 1);
  });

  it("is a circle around the origin when lb is 1", () => {
    const ring = spreadEllipse({ origin, headingDeg: 0, headKm: 5, lb: 1 });
    for (const p of ring) expect(distanceKm(origin, p)).toBeCloseTo(5, 1);
  });
});

describe("kmToMiles", () => {
  it("converts", () => {
    expect(kmToMiles(1.609344)).toBeCloseTo(1, 6);
  });
});

describe("spreadArrow", () => {
  const origin = [-120, 39];
  const zone = (headKm: number) => ({
    type: "Feature" as const,
    geometry: { type: "Polygon" as const, coordinates: [spreadEllipse({ origin, headingDeg: 90, headKm, lb: 2 })] },
    properties: { origin, headingDeg: 90, headKm },
  });

  it("runs from the origin to the furthest head", () => {
    const arrow = spreadArrow({ type: "FeatureCollection", features: [zone(3), zone(9), zone(6)] });
    const shaft = arrow.features[0]?.geometry.coordinates ?? [];
    expect(shaft[0]).toEqual(origin);
    expect(distanceKm(origin, shaft[1] ?? origin)).toBeCloseTo(9, 1);
    expect(arrow.features).toHaveLength(2);
  });

  it("is empty without spread", () => {
    expect(spreadArrow({ type: "FeatureCollection", features: [] }).features).toHaveLength(0);
  });
});

describe("compassPoint", () => {
  it("names the nearest of eight points", () => {
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(40)).toBe("NE");
    expect(compassPoint(200)).toBe("S");
    expect(compassPoint(350)).toBe("N");
    expect(compassPoint(-90)).toBe("W");
  });
});
