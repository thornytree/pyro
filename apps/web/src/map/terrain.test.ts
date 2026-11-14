import { describe, expect, it } from "vitest";
import type { TerrainConfig } from "../config";
import {
  basemapFont,
  CONTOUR_SOURCE,
  CONTOUR_THRESHOLDS,
  ELEVATION_STOPS,
  firstSymbolLayerId,
  TERRAIN_DEM_SOURCE,
  TERRAIN_LAYER_IDS,
  terrainLayers,
  terrainSources,
} from "./terrain";

const config: TerrainConfig = {
  demUrl: "https://dem.test/{z}/{x}/{y}.png",
  encoding: "terrarium",
  maxZoom: 14,
  attribution: "Elevation: test",
};

describe("terrainSources", () => {
  it("builds a raster DEM and a contour source from the config", () => {
    const sources = terrainSources(config, { dem: "dem://x", contours: "contour://y" });
    expect(sources[TERRAIN_DEM_SOURCE]).toMatchObject({
      type: "raster-dem",
      tiles: ["dem://x"],
      encoding: "terrarium",
      maxzoom: 14,
    });
    expect(sources[CONTOUR_SOURCE]).toMatchObject({
      type: "vector",
      tiles: ["contour://y"],
      maxzoom: 14,
    });
  });
});

describe("terrainLayers", () => {
  it("starts every layer hidden, ids matching TERRAIN_LAYER_IDS", () => {
    const layers = terrainLayers(["Noto Sans Regular"]);
    expect(layers.map((l) => l.id)).toEqual([...TERRAIN_LAYER_IDS]);
    for (const layer of layers) {
      expect(layer.layout).toMatchObject({ visibility: "none" });
    }
  });

  it("leaves out contour labels without a font", () => {
    const ids = terrainLayers(null).map((l) => l.id);
    expect(ids).not.toContain("pyro-contour-label");
    expect(ids).toHaveLength(TERRAIN_LAYER_IDS.length - 1);
  });
});

describe("terrain constants", () => {
  it("has ascending elevation stops", () => {
    const metres = ELEVATION_STOPS.map(([m]) => m);
    expect(metres).toEqual([...metres].sort((a, b) => a - b));
  });

  it("has major contours that are multiples of the minor ones", () => {
    for (const [minor, major] of Object.values(CONTOUR_THRESHOLDS)) {
      expect(major % minor).toBe(0);
      expect(major).toBeGreaterThan(minor);
    }
  });
});

describe("basemap helpers", () => {
  const layers = [
    { id: "bg", type: "background" },
    { id: "water", type: "fill" },
    { id: "road-label", type: "symbol", layout: { "text-font": ["literal", ["Noto Sans Bold"]] } },
    { id: "place", type: "symbol", layout: { "text-font": ["Noto Sans Regular"] } },
  ];

  it("finds the first symbol layer", () => {
    expect(firstSymbolLayerId(layers)).toBe("road-label");
    expect(firstSymbolLayerId(layers.slice(0, 2))).toBeUndefined();
  });

  it("borrows the first literal font list", () => {
    expect(basemapFont(layers)).toEqual(["Noto Sans Bold"]);
    // A data-driven font is skipped rather than mistaken for a font list.
    expect(basemapFont([{ id: "x", type: "symbol", layout: { "text-font": ["get", "f"] } }])).toBeNull();
  });
});
