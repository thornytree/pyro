import { describe, expect, it } from "vitest";
import { containsPoint } from "./geo";
import { conusStates } from "./states";

describe("conusStates", () => {
  const states = conusStates();

  it("has the 48 contiguous states plus DC", () => {
    expect(states).toHaveLength(49);
    const names = states.map((s) => s.properties.name);
    expect(names).toContain("District of Columbia");
    expect(names).not.toContain("Alaska");
    expect(names).not.toContain("Hawaii");
    expect(names).not.toContain("Puerto Rico");
  });

  it("gives each state a numeric id matching its FIPS code", () => {
    const california = states.find((s) => s.properties.fips === "06");
    expect(california?.id).toBe(6);
    expect(california?.properties.name).toBe("California");
    expect(new Set(states.map((s) => s.id)).size).toBe(states.length);
  });

  it("puts cities in the right state", () => {
    const at = (long: number, lat: number) =>
      states.find((s) => containsPoint(s.geometry, long, lat))?.properties.name;
    expect(at(-104.99, 39.74)).toBe("Colorado");
    expect(at(-121.49, 38.58)).toBe("California");
    expect(at(-97.74, 30.27)).toBe("Texas");
  });
});
