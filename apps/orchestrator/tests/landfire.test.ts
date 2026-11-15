import assert from "node:assert/strict";
import { test } from "node:test";
import { getVegetationAttributes, normalizeLandfireValues } from "../src/fan-out/landfire.ts";
import { clearRasterCache } from "../src/fan-out/raster.ts";
import { createRegionBounds } from "../src/fan-out/region.ts";
import { rasterResponse } from "./fixtures/raster.ts";

const raw = { FBFM40: 101, EVT: 7111, CC: 60, CH: 150, CBH: 32, CBD: 25 };
test("preserves fuel/vegetation codes and converts scaled canopy measurements", () => {
  assert.deepEqual(normalizeLandfireValues(raw), {
    fuel_model_code: 101, vegetation_type_code: 7111, canopy_cover_pct: 60,
    canopy_height_m: 15, canopy_base_height_m: 3.2, canopy_bulk_density_kg_m3: 0.25,
  });
  const result = normalizeLandfireValues({ ...raw, FBFM40: 98, CH: 0, CBD: null });
  assert.equal(result.fuel_model_code, 98); // Non-burnable water remains a valid category.
  assert.equal(result.canopy_height_m, 0);
  assert.equal(result.canopy_bulk_density_kg_m3, null);
  assert.throws(() => normalizeLandfireValues({ ...raw, FBFM40: 101.5 }), /FBFM40/);
  assert.throws(() => normalizeLandfireValues({ ...raw, CC: 101 }), /cover/);
});

test("fetches six versioned raw layers on the common grid and reuses static downloads", async t => {
  clearRasterCache();
  t.after(clearRasterCache);
  let count = 0;
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    count++;
    assert.ok(url.pathname.includes("Landfire_LF2025"));
    assert.equal(url.searchParams.get("interpolation"), "RSP_NearestNeighbor");
    assert.equal(url.searchParams.get("renderingRule"), '{"rasterFunction":"None"}');
    const product = /LF2025_(\w+)_CONUS/.exec(url.pathname)![1] as keyof typeof raw;
    return rasterResponse(url, raw[product]);
  });
  const first = await getVegetationAttributes(34.05, -118.25);
  const second = await getVegetationAttributes(34.05, -118.25);
  assert.equal(count, 6);
  assert.equal(first.vegetation.grid.cells.length, 784);
  assert.deepEqual(first.vegetation.grid.bounds, createRegionBounds(34.05, -118.25));
  assert.equal(first.vegetation.grid.cells[0]?.canopy_height_m, 15);
  assert.equal(first.vegetation.fetched_at, second.vegetation.fetched_at);
});
