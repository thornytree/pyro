import { describe, expect, it } from "vitest";
import type { StatePreview } from "../api/types";
import { summarizePreview } from "./preview";

const square = (west: number, south: number) => ({
  type: "Polygon" as const,
  coordinates: [[[west, south], [west + 1, south], [west + 1, south + 1], [west, south + 1], [west, south]]],
});

const preview: StatePreview = {
  stateId: "08",
  updatedAt: "2026-11-14T00:00:00Z",
  tiles: {
    type: "FeatureCollection",
    features: [
      { type: "Feature", geometry: square(-105, 39), properties: { tileId: "a", peakProbability: 0.2, meanUncertainty: 0.3 } },
      { type: "Feature", geometry: square(-104, 39), properties: { tileId: "b", peakProbability: 0.8, meanUncertainty: 0.3 } },
      { type: "Feature", geometry: square(-103, 39), properties: { tileId: "c", peakProbability: null, meanUncertainty: null } },
    ],
  },
};

describe("summarizePreview", () => {
  it("counts tiles and finds the hottest one", () => {
    expect(summarizePreview(preview)).toEqual({
      tileCount: 3,
      readyCount: 2,
      peak: 0.8,
      hotCount: 1,
      hottest: { tileId: "b", long: -103.5, lat: 39.5 },
    });
  });

  it("handles a state with no output", () => {
    const empty = { ...preview, tiles: { type: "FeatureCollection" as const, features: [] } };
    expect(summarizePreview(empty)).toMatchObject({ peak: null, hottest: null, tileCount: 0 });
  });
});
