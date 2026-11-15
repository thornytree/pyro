import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { getWeatherAttributes } from "../src/fan-out/meteo.ts";
import { createRegionBounds } from "../src/fan-out/region.ts";

const { WeatherApiResponse } = createRequire(import.meta.url)("@openmeteo/sdk/weather-api-response");

test("batches NOAA points and maps forecasts to the shared regional grid", async t => {
  const points: Array<{ latitude: number; longitude: number }> = [];
  const calls: URL[] = [];
  let badValue = false;
  let wrongModel = false;
  let missingResponse = false;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    const query = new URL(url);
    calls.push(query);
    assert.equal(query.searchParams.get("models"), "ncep_rrfs_conus");
    assert.equal(query.searchParams.get("forecast_hours"), "2");
    const latitudes = query.searchParams.get("latitude")!.split(",").map(Number);
    const longitudes = query.searchParams.get("longitude")!.split(",").map(Number);
    assert.ok(latitudes.length <= 50);
    if (missingResponse) return new Response(new Uint8Array());
    const buffer = new ArrayBuffer(latitudes.length * 8);
    const view = new DataView(buffer);
    latitudes.forEach((latitude, index) => {
      view.setInt32(index * 8, 4, true);
      view.setInt32(index * 8 + 4, points.length, true);
      points.push({ latitude, longitude: longitudes[index]! });
    });
    return new Response(buffer);
  });
  t.mock.method(WeatherApiResponse, "getSizePrefixedRootAsWeatherApiResponse", (buffer: {
    readInt32: (offset: number) => number; position: () => number;
  }) => {
    const point = points[buffer.readInt32(buffer.position() + 4)]!;
    return {
      model: () => wrongModel ? 1 : 156,
      latitude: () => point.latitude + 0.005, longitude: () => point.longitude,
      elevation: () => 100,
      current: () => ({ time: () => 1700000000n, variables: (index: number) => ({ value: () => badValue && index === 0 ? NaN : index }) }),
      hourly: () => ({
        time: () => 1700000000n, timeEnd: () => 1700007200n, interval: () => 3600,
        variables: (index: number) => ({ valuesArray: () => new Float32Array([index, index + 1]) }),
      }),
    };
  });
  const result = await getWeatherAttributes(34.05, -118.25, { forecastHours: 2 });
  assert.equal(calls.length, 3);
  assert.equal(points.length, 101);
  const grid = result.weather_grid;
  assert.equal(grid.cells.length, 784);
  assert.equal(grid.rows * grid.columns, grid.cells.length);
  assert.equal(grid.source_resolution_km, 3);
  assert.deepEqual(grid.bounds, createRegionBounds(34.05, -118.25));
  assert.equal(result.weather.temperature, 0);
  assert.equal(result.weather.precipitation_mm, 4);
  assert.equal(grid.samples[0]?.hourly.length, 2);
  assert.equal(grid.samples[0]?.hourly[1]?.time, "2023-11-14T23:13:20.000Z");
  assert.notDeepEqual(grid.samples[0]?.requested_location, grid.samples[0]?.source_location);
  for (const cell of grid.cells) {
    assert.ok(cell.sample_index > 0 && cell.sample_index < grid.samples.length);
  }
  badValue = true;
  await assert.rejects(getWeatherAttributes(34, -118, { forecastHours: 2 }), /temperature/);
  badValue = false;
  wrongModel = true;
  await assert.rejects(getWeatherAttributes(34, -118, { forecastHours: 2 }), /unexpected weather model/);
  wrongModel = false;
  missingResponse = true;
  await assert.rejects(getWeatherAttributes(34, -118, { forecastHours: 2 }), /coverage/);
});

test("rejects invalid coordinates and horizons before calling the API", async () => {
  await assert.rejects(getWeatherAttributes(91, 0), /latitude/);
  await assert.rejects(getWeatherAttributes(34, -118, { forecastHours: 0 }), /Forecast hours/);
  await assert.rejects(getWeatherAttributes(34, -118, { forecastHours: 73 }), /Forecast hours/);
});
