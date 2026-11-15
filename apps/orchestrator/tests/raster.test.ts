import assert from "node:assert/strict";
import { test } from "node:test";
import { clearRasterCache, decodeRaster, fetchRaster } from "../src/fan-out/raster.ts";
import { rasterBytes, rasterResponse } from "./fixtures/raster.ts";

const bounds = { west: -119, east: -117, south: 33, north: 35 };
test("decodes numeric GeoTIFFs, preserving zero and representing missing pixels as null", async () => {
  const raster = await decodeRaster(rasterBytes(bounds, 2, 2, (row, column) => row === 0 && column === 0 ? -9999 : column));
  assert.deepEqual(raster.values, [null, 1, 0, 1]);
  assert.deepEqual(raster.bounds, bounds);
  await assert.rejects(decodeRaster(new TextEncoder().encode('{"error":"No data"}').buffer), /byte order/);
  await assert.rejects(decodeRaster(rasterBytes(bounds, 2, 2, -9999)), /no usable data/);
});

test("failed downloads are evicted, successful concurrent requests share a cached raster", async t => {
  clearRasterCache();
  t.after(clearRasterCache);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    calls++;
    return calls === 1 ? new Response("Unavailable", { status: 503 }) : rasterResponse(url, 10);
  });
  const run = () => fetchRaster("https://example.test/ImageServer", bounds, 2, 2, "bilinear");
  await assert.rejects(run(), /retrieve raster/);
  const [a, b] = await Promise.all([run(), run()]);
  assert.equal(calls, 2);
  assert.strictEqual(a, b);
});
