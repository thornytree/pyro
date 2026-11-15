import assert from "node:assert/strict";
import { test } from "node:test";
import { SourceFetchError } from "../src/fan-out/source-error.ts";
import { makeBundle } from "./fixtures/bundle.ts";
import { createApp } from "../src/app.ts";
import { readConfig } from "../src/config.ts";
import type { FanOutOptions } from "../src/fan-out/fan-out-entry.ts";
import { createInference } from "../src/inference.ts";
import type { InferenceResult } from "../src/inference.ts";
import { occurrenceBody, spreadBody } from "./fixtures/inference.ts";

const env = {
  FIRMS_MAP_KEY: "private-firms", EARTHDATA_TOKEN: "private-earthdata",
  DAYMET_START_DATE: "2020-07-01", DAYMET_END_DATE: "2020-07-31",
};

test("validates server settings without exposing credential values", () => {
  assert.throws(() => readConfig({}), /FIRMS_MAP_KEY, EARTHDATA_TOKEN/);
  for (const override of [
    { PORT: "abc" }, { PORT: "65536" }, { DEFAULT_FORECAST_HOURS: "0" },
    { DAYMET_START_DATE: "2020-02-30" }, { DAYMET_END_DATE: "2019-01-01" },
    { DAYMET_END_DATE: "2023-01-01" }, { WEB_ORIGIN: "javascript:bad" },
    { LANDFIRE_VERSION: "wrong" }, { EARTHDATA_TOKEN: "  " },
    { INFERENCE_URL: "ftp://models" }, { INFERENCE_URL: "http://user:secret@models" }, { INFERENCE_TIMEOUT_MS: "0" },
  ]) assert.throws(() => readConfig({ ...env, ...override }));
  const config = readConfig(env);
  assert.equal(config.port, 3001);
  assert.equal(config.defaults.forecastHours, 24);
  assert.deepEqual(config.inference, { url: null, timeoutMs: 20000 });
  assert.deepEqual(readConfig({ ...env, INFERENCE_URL: "http://127.0.0.1:8000/", INFERENCE_TIMEOUT_MS: "5000" }).inference,
    { url: "http://127.0.0.1:8000", timeoutMs: 5000 });
  assert.ok(!JSON.stringify(config).includes("private-"));
});


test("serves health, parses the web query, returns observations/bundle and sanitizes errors", async t => {
  const calls: Array<{ lat: number; long: number; options: FanOutOptions }> = [];
  let fail = false;
  let typedFailure = false;
  const config = readConfig(env);
  const app = createApp(config, async (lat, long, options) => {
    calls.push({ lat, long, options });
    if (typedFailure) throw new SourceFetchError("Daymet", new Error("Daymet returned HTTP 404"));
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
  const preview = await (await fetch(`${base}/states/06/preview`)).json();
  assert.deepEqual(preview, { stateId: "06", updatedAt: null, tiles: { type: "FeatureCollection", features: [] } });
  assert.equal((await fetch(`${base}/states/02/preview`)).status, 404);
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
  assert.equal(diagnosed.error.source, "Daymet");
  assert.equal(diagnosed.error.upstreamStatus, 404);
  assert.ok(!JSON.stringify(diagnosed).includes("private-"));
});

test("runs the models on the fetched bundle and falls back to observations when they fail", async t => {
  const config = readConfig(env);
  const bundle = makeBundle();
  const modelFetch = (async (input: RequestInfo | URL) => new Response(JSON.stringify(
    String(input).endsWith("/predict") ? occurrenceBody(bundle) : spreadBody(bundle)))) as typeof fetch;
  let inference: InferenceResult = await createInference({ url: "http://inference.test", timeoutMs: 500 }, modelFetch)(bundle);
  const received: unknown[] = [];
  const app = createApp(config, async () => bundle,
    async sent => { received.push(sent); return inference; },
    async () => "connected");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve); server.once("error", reject);
  });
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;

  assert.equal((await (await fetch(`${base}/health`)).json()).inference, "connected");
  assert.equal(received.length, 0);

  const ready = await (await fetch(`${base}/tiles?lat=34.05&long=-118.25`)).json();
  assert.equal(received[0], bundle);
  assert.equal(ready.status, "ready");
  assert.equal(ready.updatedAt, "2026-11-15T09:00:00+00:00");
  assert.equal(ready.cells.features.length, 784);
  assert.equal(ready.cells.features[0].properties.riskScore, 0.7);
  assert.equal(ready.spread.features.length, 3);
  assert.equal(ready.drivers.windFromDeg, 270);
  assert.equal(ready.model.spread.status, "ok");
  assert.equal(ready.detections.features.length, 2);
  assert.equal(ready.bundle.terrain.source, "USGS 3DEP");

  const message = "Inference service is not reachable at http://127.0.0.1:8000.";
  inference = { status: "failed", reason: "unreachable", message };
  const observed = await fetch(`${base}/tiles?lat=34.05&long=-118.25`);
  assert.equal(observed.status, 200);
  const fallback = await observed.json();
  assert.equal(fallback.status, "observed");
  assert.equal(fallback.updatedAt, null);
  assert.deepEqual(fallback.cells.features, []);
  assert.equal(fallback.model, null);
  assert.deepEqual(fallback.inference, { status: "failed", reason: "unreachable", message });
  assert.equal(fallback.detections.features.length, 2);
});

test("lists confirmed fires from one cached nationwide FIRMS poll", async t => {
  const now = Date.now();
  const detection = (latitude: number, longitude: number, hoursAgo: number, value: "low" | "nominal" | "high") => ({
    source: "VIIRS_SNPP_NRT" as const, instrument: "VIIRS" as const, satellite: "N", tile_id: "r01c01",
    location: { latitude, longitude }, observation_time: new Date(now - hoursAgo * 3_600_000).toISOString(),
    frp_mw: 12, scan_km: 0.4, track_km: 0.4, confidence: { kind: "category" as const, value },
  });
  let polls = 0;
  const app = createApp(readConfig(env), async () => makeBundle(), async () => ({ status: "not_configured" }),
    async () => "not_connected",
    async () => {
      polls++;
      return { fetched_at: new Date(now).toISOString(), days: 2, detections: [
        detection(39.01, -121.01, 2, "high"), detection(39.02, -121.02, 3, "nominal"),
        detection(34.6, -118.1, 1, "nominal"),
        detection(45.1, -110.1, 1, "low"), detection(41.1, -100.1, 30, "high"),
      ] };
    });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve); server.once("error", reject);
  });
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;

  const body = await (await fetch(`${base}/fires`)).json();
  // Low-confidence and day-old detections are not confirmed fire.
  assert.deepEqual(body.fires.map((f: { detections: number }) => f.detections), [2, 1]);
  assert.ok(Math.abs(body.fires[0].latitude - 39.015) < 1e-9);
  assert.equal(body.fires[0].frpMaxMw, 12);
  await fetch(`${base}/fires`);
  assert.equal(polls, 1);

  const failing = createApp(readConfig(env), async () => makeBundle(), async () => ({ status: "not_configured" }),
    async () => "not_connected", async () => { throw new Error("https://firms.test/private-firms"); }).listen(0, "127.0.0.1");
  await new Promise<void>(resolve => failing.once("listening", resolve));
  t.after(() => new Promise<void>(resolve => failing.close(() => resolve())));
  const failingAddress = failing.address();
  assert.ok(failingAddress && typeof failingAddress !== "string");
  const failed = await fetch(`http://127.0.0.1:${failingAddress.port}/fires`);
  assert.equal(failed.status, 502);
  assert.ok(!JSON.stringify(await failed.json()).includes("private-"));
});
