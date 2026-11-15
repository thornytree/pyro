import { describe, expect, it } from "vitest";
import { availableViews } from "./ViewSwitch";

describe("availableViews", () => {
  it("offers the heat map first, then each configured base view", () => {
    expect(availableViews(true, true)).toEqual(["heat", "terrain", "satellite"]);
    expect(availableViews(true, false)).toEqual(["heat", "terrain"]);
    expect(availableViews(false, true)).toEqual(["heat", "satellite"]);
  });

  it("falls back to the plain basemap so the overlay can always be switched off", () => {
    expect(availableViews(false, false)).toEqual(["heat", "map"]);
  });
});
