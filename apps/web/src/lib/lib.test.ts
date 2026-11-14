import { describe, expect, it } from "vitest";
import { ageHours, formatAge } from "./age";
import { isInConusBounds } from "./conus";
import { loadConfig } from "../config";

describe("isInConusBounds", () => {
  it.each([
    ["Denver", 39.74, -104.99, true],
    ["Miami", 25.76, -80.19, true],
    ["Anchorage", 61.22, -149.9, false],
    ["Honolulu", 21.31, -157.86, false],
    ["London", 51.5, -0.12, false],
  ])("%s", (_name, lat, long, expected) => {
    expect(isInConusBounds(lat, long)).toBe(expected);
  });
});

describe("age", () => {
  const now = new Date("2026-11-14T12:00:00Z");

  it("computes hours and never goes negative", () => {
    expect(ageHours("2026-11-14T09:00:00Z", now)).toBe(3);
    expect(ageHours("2026-11-14T13:00:00Z", now)).toBe(0);
    expect(ageHours("not a date", now)).toBe(Number.POSITIVE_INFINITY);
  });

  it("formats by magnitude", () => {
    expect(formatAge(0.5)).toBe("30 min ago");
    expect(formatAge(5)).toBe("5 h ago");
    expect(formatAge(72)).toBe("3 d ago");
    expect(formatAge(Number.POSITIVE_INFINITY)).toBe("unknown");
  });
});

describe("loadConfig", () => {
  const style = "https://example.test/style.json";

  it("strips trailing slashes from the orchestrator URL", () => {
    const config = loadConfig({
      VITE_ORCHESTRATOR_URL: "http://localhost:3001/",
      VITE_MAP_STYLE_URL: style,
    });
    expect(config).toEqual({
      orchestratorUrl: "http://localhost:3001",
      mapStyleUrl: style,
      useMock: false,
      terrain: null,
    });
  });

  it("requires the orchestrator URL unless mocking", () => {
    expect(() => loadConfig({ VITE_MAP_STYLE_URL: style })).toThrow(
      /VITE_ORCHESTRATOR_URL/,
    );
    expect(
      loadConfig({ VITE_MAP_STYLE_URL: style, VITE_USE_MOCK: "true" }).useMock,
    ).toBe(true);
  });

  it("requires the map style URL", () => {
    expect(() => loadConfig({ VITE_USE_MOCK: "true" })).toThrow(/VITE_MAP_STYLE_URL/);
  });

  describe("terrain", () => {
    const base = { VITE_MAP_STYLE_URL: style, VITE_USE_MOCK: "true" };
    const terrain = {
      VITE_TERRAIN_DEM_URL: "https://dem.test/{z}/{x}/{y}.png",
      VITE_TERRAIN_DEM_ENCODING: "terrarium",
      VITE_TERRAIN_DEM_MAXZOOM: "15",
      VITE_TERRAIN_ATTRIBUTION: "Elevation: test",
    };

    it("is off when no DEM URL is set", () => {
      expect(loadConfig(base).terrain).toBeNull();
    });

    it("reads the DEM settings", () => {
      expect(loadConfig({ ...base, ...terrain }).terrain).toEqual({
        demUrl: terrain.VITE_TERRAIN_DEM_URL,
        encoding: "terrarium",
        maxZoom: 15,
        attribution: "Elevation: test",
      });
    });

    it.each([
      ["VITE_TERRAIN_DEM_ENCODING", "png", /terrarium/],
      ["VITE_TERRAIN_DEM_MAXZOOM", "12.5", /integer/],
      ["VITE_TERRAIN_DEM_MAXZOOM", "30", /integer/],
      ["VITE_TERRAIN_ATTRIBUTION", "", /VITE_TERRAIN_ATTRIBUTION/],
    ])("rejects %s=%s", (name, value, message) => {
      expect(() => loadConfig({ ...base, ...terrain, [name]: value })).toThrow(message);
    });
  });
});
