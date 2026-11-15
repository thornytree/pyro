import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { clearRasterCache } from "../src/fan-out/raster.ts";
import { rasterResponse } from "./fixtures/raster.ts";
import { fanOutEntry } from "../src/fan-out/fan-out-entry.ts";

const { WeatherApiResponse } = createRequire(import.meta.url)("@openmeteo/sdk/weather-api-response");
const axes = readFileSync(new URL("./fixtures/daymet-axes.nc", import.meta.url));
const fixture = readFileSync(new URL("./fixtures/daymet-small.nc", import.meta.url));

test("fans out all providers and assembles a complete JSON-safe bundle only after success", async t => {
  clearRasterCache();
  t.after(clearRasterCache);
  const originalKey = process.env.FIRMS_MAP_KEY;
  process.env.FIRMS_MAP_KEY = "test-key";
  t.after(() => {
    if (originalKey === undefined) delete process.env.FIRMS_MAP_KEY;
    else process.env.FIRMS_MAP_KEY = originalKey;
  });
  const requests: URL[] = [];
  let failFire = false;
  let expectedRequests = 21;
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    const url = new URL(input);
    if (url.hostname === "opendap.earthdata.nasa.gov" &&
        url.searchParams.get("dap4.ce") === "/x;/y;/time;/lambert_conformal_conic") {
      return new Response(Uint8Array.from(axes).buffer);
    }
    requests.push(url);
    await new Promise(resolve => setImmediate(resolve));
    // Weather, fire, Daymet, DEM and six LANDFIRE layers all start concurrently.
    assert.equal(requests.length, expectedRequests);
    if (url.hostname === "firms.modaps.eosdis.nasa.gov") {
      return failFire ? new Response("Unavailable", { status: 503 }) :
        new Response("latitude,longitude,acq_date,acq_time,satellite,confidence,frp,scan,track\n");
    }
    if (url.hostname === "opendap.earthdata.nasa.gov") {
      return new Response(Uint8Array.from(fixture).buffer);
    }
    if (url.pathname.endsWith("/exportImage")) {
      const raw: Record<string, number> = { FBFM40: 101, EVT: 7111, CC: 60, CH: 150, CBH: 32, CBD: 25 };
      const product = /LF2025_(\w+)_CONUS/.exec(url.pathname)?.[1];
      return rasterResponse(url, product ? raw[product]! : 250);
    }
    assert.equal(url.hostname, "api.open-meteo.com");
    const count = url.searchParams.get("latitude")!.split(",").length;
    const buffer = new ArrayBuffer(count * 8);
    const view = new DataView(buffer);
    for (let i = 0; i < count; i++) view.setInt32(i * 8, 4, true);
    return new Response(buffer);
  });
  t.mock.method(WeatherApiResponse, "getSizePrefixedRootAsWeatherApiResponse", () => ({
    model: () => 156, latitude: () => 34.05, longitude: () => -118.25, elevation: () => 100,
    current: () => ({ time: () => 1700000000n, variables: (i: number) => ({ value: () => i }) }),
    hourly: () => ({
      time: () => 1700000000n, timeEnd: () => 1700003600n, interval: () => 3600,
      variables: (i: number) => ({ valuesArray: () => new Float32Array([i]) }),
    }),
  }));
  const options = { forecastHours: 1, daymet: { startDate: "2020-02-28", endDate: "2020-03-01" } };
  const bundle = await fanOutEntry(34.05, -118.25, options);
  assert.deepEqual(bundle.location, { latitude: 34.05, longitude: -118.25 });
  assert.equal(bundle.observation_time, "2023-11-14T22:13:20.000Z");
  assert.deepEqual(bundle.fire.detections, []);
  assert.equal(bundle.historical_weather.grids.length, 7);
  assert.equal(bundle.historical_weather.start_date, options.daymet.startDate);
  assert.deepEqual(bundle.historical_weather.bounds, bundle.weather_grid.bounds);
  assert.deepEqual(bundle.historical_weather.grid.cells, bundle.weather_grid.cells.map(({ sample_index, ...point }) => point));
  assert.equal(bundle.terrain.source, "USGS 3DEP");
  assert.equal(bundle.terrain.elevation_m, 250); // Must come from 3DEP, not Open-Meteo's 100.
  assert.equal(bundle.terrain.slope_degrees, 0);
  assert.equal(bundle.terrain.aspect_degrees, null);
  assert.equal(bundle.vegetation.grid.cells[0]?.fuel_model_code, 101);
  assert.equal(bundle.vegetation.grid.cells[0]?.canopy_height_m, 15);
  assert.deepEqual(bundle.terrain.grid.bounds, bundle.weather_grid.bounds);
  assert.deepEqual(bundle.vegetation.grid.bounds, bundle.weather_grid.bounds);
  assert.deepEqual(JSON.parse(JSON.stringify(bundle)), bundle);

  requests.length = 0;
  expectedRequests = 14; // Static raster downloads are now cached.
  failFire = true;
  await assert.rejects(fanOutEntry(34.05, -118.25, options), /FIRMS.*503/);
});
