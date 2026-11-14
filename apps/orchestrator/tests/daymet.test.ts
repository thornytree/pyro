import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getDaymetAttributes, normalizeDaymetAttributes } from "../src/fan-out/daymet.ts";
import { createRegionBounds } from "../src/fan-out/region.ts";

// Small classic NetCDF fixture: 2x2 cells, three days including Feb 29, all seven variables.
const fixture = readFileSync(new URL("./fixtures/daymet-small.nc", import.meta.url));
const bytes = () => Uint8Array.from(fixture).buffer;

test("decodes real NetCDF values, leap dates, missing data and packed scale/offset", () => {
  const grid = normalizeDaymetAttributes(bytes(), "tmin", 2020,
    createRegionBounds(34.05, -118.25), "2020-02-28", "2020-03-01");
  assert.deepEqual(grid.dates, ["2020-02-28", "2020-02-29", "2020-03-01"]);
  assert.equal(grid.rows, 2);
  assert.equal(grid.columns, 2);
  assert.deepEqual(grid.values.slice(0, 4), [null, 1, 3, 5]);
  assert.equal(grid.units, "degrees C");
  assert.equal(grid.sample_indices.length, 784);
  assert.ok(grid.sample_indices.every(index => index >= 0 && index < 4));
});

test("clips projected-border cells and time range without fabricating dates", () => {
  const grid = normalizeDaymetAttributes(bytes(), "prcp", 2020,
    { west: -118.27, east: -118.23, south: 34.05, north: 34.07 }, "2020-02-29", "2020-02-29");
  assert.deepEqual(grid.dates, ["2020-02-29"]);
  assert.deepEqual(grid.values, [3, 4, null, null]);
  assert.ok(grid.sample_indices.every(index => index === 0 || index === 1));
});

test("downloads seven bounded regional subsets with Earthdata auth", async t => {
  const calls: URL[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    calls.push(url);
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer test-token");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 7);
    return new Response(bytes());
  });
  const result = await getDaymetAttributes(34.05, -118.25, "2020-02-28", "2020-03-01", { token: "test-token" });
  assert.equal(result.historical_weather?.grids.length, 7);
  assert.deepEqual(result.historical_weather?.bounds, createRegionBounds(34.05, -118.25));
  assert.ok(calls.every(url => url.searchParams.get("horizStride") === "1"));
  assert.ok(calls.every(url => url.searchParams.get("time_start") === "2020-02-28T00:00:00Z"));
  assert.ok(calls.every(url => url.searchParams.get("accept") === "netcdf"));
});

test("reports auth and invalid binary responses, and rejects bad date ranges", async t => {
  const mock = t.mock.method(globalThis, "fetch", async () => new Response("Unauthorized", { status: 401 }));
  await assert.rejects(getDaymetAttributes(34, -118, "2020-01-01", "2020-01-02"), /EARTHDATA_TOKEN/);
  mock.mock.restore();
  t.mock.method(globalThis, "fetch", async () => new Response("<html>Login</html>"));
  await assert.rejects(getDaymetAttributes(34, -118, "2020-01-01", "2020-01-02"), /NetCDF/);
  await assert.rejects(getDaymetAttributes(34, -118, "2020-02-30", "2020-03-01"), /date/);
  await assert.rejects(getDaymetAttributes(34, -118, "2020-02-28", "2020-01-01"), /range/);
});
