import { describe, expect, it } from "vitest";
import { metresPerPixel, niceNumber, scaleBar } from "./scale";

describe("metresPerPixel", () => {
  it("matches Web Mercator at the equator and halves per zoom level", () => {
    expect(metresPerPixel(0, 0)).toBeCloseTo(78_271.5, 0);
    expect(metresPerPixel(0, 1)).toBeCloseTo(metresPerPixel(0, 0) / 2, 6);
  });

  it("shrinks with latitude", () => {
    expect(metresPerPixel(60, 5)).toBeCloseTo(metresPerPixel(0, 5) / 2, 6);
  });
});

describe("niceNumber", () => {
  it.each([
    [1, 1],
    [1.9, 1],
    [2, 2],
    [4.99, 2],
    [5, 5],
    [9.9, 5],
    [10, 10],
    [0.37, 0.2],
    [1234, 1000],
    [0, 0],
  ])("%s -> %s", (input, expected) => {
    expect(niceNumber(input)).toBeCloseTo(expected, 9);
  });
});

describe("scaleBar", () => {
  it("picks a round distance that fits", () => {
    // 120 px x 250 m/px = 30 km -> 20 km bar of 80 px.
    expect(scaleBar(250, 120, "metric")).toEqual({ widthPx: 80, label: "20 km" });
  });

  it("drops to metres below a kilometre", () => {
    // 120 px x 5 m/px = 600 m -> 500 m.
    expect(scaleBar(5, 120, "metric")).toEqual({ widthPx: 100, label: "500 m" });
  });

  it("uses miles and feet for imperial", () => {
    const miles = scaleBar(250, 120, "imperial");
    expect(miles.label).toBe("10 mi");
    expect(miles.widthPx).toBeCloseTo(64.37, 2);
    expect(scaleBar(5, 120, "imperial").label).toBe("1,000 ft");
  });

  it("never exceeds the maximum width", () => {
    for (const mpp of [0.3, 7, 91, 1234, 40_000]) {
      for (const unit of ["metric", "imperial"] as const) {
        const { widthPx } = scaleBar(mpp, 120, unit);
        expect(widthPx).toBeGreaterThan(0);
        expect(widthPx).toBeLessThanOrEqual(120 + 1e-9);
      }
    }
  });
});
