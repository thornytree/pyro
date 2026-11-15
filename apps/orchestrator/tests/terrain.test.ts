import assert from "node:assert/strict";
import { test } from "node:test";
import { terrainAt } from "../src/fan-out/terrain.ts";
import type { RasterGrid } from "../src/fan-out/raster.ts";

const metresPerDegree = 6371008.8 * Math.PI / 180;
const halfSpan = 1.5 / metresPerDegree;
function plane(east: number, north: number): RasterGrid {
  return {
    fetched_at: "2020-01-01T00:00:00Z", width: 3, height: 3,
    bounds: { west: -halfSpan, east: halfSpan, south: -halfSpan, north: halfSpan },
    values: Array.from({ length: 9 }, (_, i) => 100 + east * (i % 3 - 1) + north * (1 - Math.floor(i / 3))),
  };
}

test("derives slope in degrees and downhill compass bearings from analytic planes", () => {
  for (const [east, north, aspect] of [[1, 0, 270], [-1, 0, 90], [0, 1, 180], [0, -1, 0]]) {
    const values = terrainAt(plane(east!, north!), { latitude: 0, longitude: 0 });
    assert.equal(values.elevation_m, 100);
    assert.ok(Math.abs(values.slope_degrees! - 45) < 1e-10);
    assert.equal(values.aspect_degrees, aspect);
  }
  assert.deepEqual(terrainAt(plane(0, 0), { latitude: 0, longitude: 0 }), {
    elevation_m: 100, slope_degrees: 0, aspect_degrees: null,
  });
});

test("missing neighbours preserve elevation but leave slope/aspect unknown", () => {
  const raster = plane(1, 1);
  raster.values[0] = null;
  assert.deepEqual(terrainAt(raster, { latitude: 0, longitude: 0 }), {
    elevation_m: 100, slope_degrees: null, aspect_degrees: null,
  });
});
