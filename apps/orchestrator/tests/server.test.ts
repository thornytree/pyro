import assert from "node:assert/strict";
import { test } from "node:test";
import { SourceFetchError } from "../src/fan-out/source-error.ts";
import { makeBundle } from "./fixtures/bundle.ts";
import { createApp } from "../src/app.ts";
import { readConfig } from "../src/config.ts";
import type { FanOutOptions } from "../src/fan-out/fan-out-entry.ts";

const env = {
  FIRMS_MAP_KEY: "private-firms", EARTHDATA_TOKEN: "private-earthdata",
  DAYMET_START_DATE: "2020-07-01", DAYMET_END_DATE: "2020-07-31",
  // Each request below must reach the stubbed fan-out; the cache has its own test.
  TILE_CACHE_TTL_SECONDS: "0",
};

test("validates server settings without exposing credential values", () => {
  assert.throws(() => readConfig({}), /FIRMS_MAP_KEY, EARTHDATA_TOKEN/);
  for (const override of [
    { PORT: "abc" }, { PORT: "65536" }, { DEFAULT_FORECAST_HOURS: "0" },
    { DAYMET_START_DATE: "2020-02-30" }, { DAYMET_END_DATE: "2019-01-01" },
    { DAYMET_END_DATE: "2023-01-01" }, { WEB_ORIGIN: "javascript:bad" },
    { LANDFIRE_VERSION: "wrong" }, { EARTHDATA_TOKEN: "  " },
    { STATE_GRID_MAX_POINTS: "5" }, { STATE_CACHE_TTL_MINUTES: "0" }, { TILE_CACHE_TTL_SECONDS: "-1" },
  ]) assert.throws(() => readConfig({ ...env, ...override }));
  const config = readConfig(env);
  assert.equal(config.port, 3001);
  assert.deepEqual(config.stateHeatmap, { maxPoints: 300, ttlMs: 180 * 60_000 });
  assert.equal(config.tileCacheTtlMs, 0);
  assert.equal(readConfig({ ...env, TILE_CACHE_TTL_SECONDS: "" }).tileCacheTtlMs, 300_000);
  assert.equal(config.defaults.forecastHours, 24);
  assert.ok(!JSON.stringify(config).includes("private-"));
});


test("serves health, parses the web query, returns observations/bundle and sanitizes errors", async t => {
  const calls: Array<{ lat: number; long: number; options: FanOutOptions }> = [];
  let fail = false;
  let typedFailure = false;
  const config = readConfig(env);
  const app = createApp(config, async (lat, long, options) => {
    calls.push({ lat, long, options });
    if (typedFailure) throw new SourceFetchError("Open-Meteo", new Error("Open-Meteo returned HTTP 404"));
    if (fail) throw new Error("https://provider.test/private-firms?token=private-earthdata");
    return makeBundle();
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve); server.once("error", reject);
  });
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.status, "ok");
  assert.equal(health.inference, "not_connected");
  assert.ok(!JSON.stringify(health).includes("private-"));
  assert.equal(calls.length, 0);

  const response = await fetch(`${base}/tiles?lat=34.05&long=-118.25`, { headers: { Origin: config.webOrigin } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), config.webOrigin);
  const result = await response.json();
  assert.equal(result.status, "observed");
  assert.equal(result.updatedAt, null);
  assert.deepEqual(result.cells.features, []);
  assert.equal(result.bundle.terrain.source, "USGS 3DEP");
  assert.deepEqual(result.detections.features[0].geometry.coordinates, [-118.25, 34.05]);
  assert.equal(result.detections.features[0].properties.source, "MODIS");
  assert.equal(result.detections.features[0].properties.confidence, 0.8);
  assert.equal(result.detections.features[1].properties.confidence, null);
  assert.equal(result.detections.features[1].properties.confidenceCategory, "nominal");
  assert.deepEqual(calls[0], { lat: 34.05, long: -118.25, options: config.defaults });

  const customized = await fetch(`${base}/tiles?lat=34.05&long=-118.25&forecastHours=12&daymetStart=2021-01-01&daymetEnd=2021-01-03`);
  assert.equal(customized.status, 200);
  assert.equal(calls[1]?.options.forecastHours, 12);
  assert.deepEqual(calls[1]?.options.daymet, { startDate: "2021-01-01", endDate: "2021-01-03" });
  const count = calls.length;
  for (const query of ["", "lat=&long=1", "lat=NaN&long=-118", "lat=91&long=0", "lat=34&lat=35&long=-118", "lat=34&long=-118&forecastHours=0", "lat=34&long=-118&daymetStart=2020-02-30"]) {
    assert.equal((await fetch(`${base}/tiles?${query}`)).status, 400);
  }
  assert.equal((await fetch(`${base}/tiles?lat=0&long=0`)).status, 422);
  assert.equal(calls.length, count);
  assert.equal((await fetch(`${base}/tiles?lat=34&long=-118`, { headers: { Origin: "https://unknown.test" } })).status, 403);
  assert.equal((await fetch(`${base}/tiles`, { method: "OPTIONS", headers: { Origin: config.webOrigin } })).status, 204);
  assert.equal((await fetch(`${base}/states/02/heatmap`)).status, 404);
  assert.equal((await fetch(`${base}/states/06/preview`)).status, 404);
  assert.equal((await fetch(`${base}/unknown`)).status, 404);
  fail = true;
  const failed = await fetch(`${base}/tiles?lat=34.05&long=-118.25`);
  assert.equal(failed.status, 502);
  const error = await failed.text();
  assert.ok(error.includes("SOURCE_FETCH_FAILED"));
  assert.ok(!error.includes("private-"));
  fail = false;
  typedFailure = true;
  const diagnosed = await (await fetch(`${base}/tiles?lat=34.05&long=-118.25`)).json();
  assert.equal(diagnosed.error.source, "Open-Meteo");
  assert.equal(diagnosed.error.upstreamStatus, 404);
  assert.ok(!JSON.stringify(diagnosed).includes("private-"));
});

test("reuses a region's source bundle, but not one with a failed source, and compresses responses", async t => {
  let calls = 0;
  let failing = true;
  const app = createApp(readConfig({ ...env, TILE_CACHE_TTL_SECONDS: "60" }), async () => {
    calls++;
    const bundle = makeBundle();
    return failing ? { ...bundle, fire: null, source_failures: [{ source: "FIRMS" as const, reason: "TIMEOUT" as const, message: "FIRMS failed." }] } : bundle;
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/tiles?lat=34.05&long=-118.25`;

  assert.equal((await (await fetch(url)).json()).bundle.fire, null);
  failing = false;
  const response = await fetch(url);
  assert.equal(response.headers.get("content-encoding"), "gzip");
  assert.equal((await response.json()).detections.features.length, 2);
  assert.equal(calls, 2); // The degraded bundle was not kept.
  await fetch(url);
  await fetch(`${url}&forecastHours=24`); // Same resolved options as the default.
  assert.equal(calls, 2);
  await fetch(`${url}&forecastHours=12`);
  assert.equal(calls, 3);
});
