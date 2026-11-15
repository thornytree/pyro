import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.ts";
import { readConfig } from "../src/config.ts";
import { predictBundle, validatePrediction } from "../src/inference/client.ts";
import type { InferenceResult } from "../src/inference/client.ts";
import { makeBundle } from "./fixtures/bundle.ts";

function modelBundle() {
  const b = makeBundle();
  b.weather_grid.samples[0]!.hourly = Array.from({ length: 24 }, (_, hour) => ({
    ...b.weather, time: new Date(Date.parse(b.observation_time) + hour * 3600000).toISOString(),
  }));
  return b;
}
function result(): InferenceResult {
  const b = modelBundle();
  const g = b.weather_grid;
  const dx = (g.bounds.east - g.bounds.west) / g.columns;
  const dy = (g.bounds.north - g.bounds.south) / g.rows;
  return {
    updatedAt: b.observation_time,
    prediction: {
      modelVersion: "fixture-model", target: "any_firms_detection_in_10km_cell_day", scoreKind: "sample_relative",
      horizonHours: 24, nativeResolutionKm: 10, nativeCellCount: 1,
      uncertaintyKind: "twice_bootstrap_ensemble_standard_deviation", experimental: true,
      windowStart: b.observation_time, windowEnd: new Date(Date.parse(b.observation_time) + 86400000).toISOString(),
    },
    cells: { type: "FeatureCollection", features: g.cells.map((_, index) => {
      const west = g.bounds.west + index % g.columns * dx;
      const north = g.bounds.north - Math.floor(index / g.columns) * dy;
      return {
        type: "Feature", geometry: { type: "Polygon", coordinates: [[[west, north - dy], [west + dx, north - dy], [west + dx, north], [west, north], [west, north - dy]]] },
        properties: { probability: 0.6, uncertainty: 0.1, nativeCellId: "r24c07_00" },
      };
    }) },
  };
}

test("validates scores, cell coverage, geography and forecast window", () => {
  assert.equal(validatePrediction(result(), modelBundle()).cells.features.length, 784);
  const badScore = result(); badScore.cells.features[0]!.properties.probability = 1.1;
  const badGeometry = result(); badGeometry.cells.features[0]!.geometry.coordinates[0]![0]![0]! += 1;
  const missing = result(); missing.cells.features.pop();
  const wrongTime = result(); wrongTime.prediction.windowStart = "2020-01-01T00:00:00Z";
  for (const value of [badScore, badGeometry, missing, wrongTime]) assert.throws(() => validatePrediction(value, modelBundle()));
});

test("posts the actual bundle and rejects an unsuccessful model response", async t => {
  let fail = false;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "http://model.test/predict");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(String(init.body)).location, modelBundle().location);
    return fail ? new Response("bad request", { status: 422 }) : Response.json(result());
  });
  assert.equal((await predictBundle(modelBundle(), "http://model.test", 1000)).prediction.scoreKind, "sample_relative");
  fail = true;
  await assert.rejects(predictBundle(modelBundle(), "http://model.test", 1000), /HTTP 422/);
});

test("Express returns model cells and preserves observations on inference failure", async t => {
  const config = readConfig({
    FIRMS_MAP_KEY: "test", EARTHDATA_TOKEN: "test", DAYMET_START_DATE: "2020-07-01", DAYMET_END_DATE: "2020-07-03",
    INFERENCE_URL: "http://model.test/", INFERENCE_TIMEOUT_MS: "1000",
  });
  let fail = false;
  const app = createApp(config, async () => modelBundle(), async (_bundle, url) => {
    assert.equal(url, "http://model.test");
    if (fail) throw new Error("private URL or provider details");
    return result();
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  t.after(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/tiles?lat=34.05&long=-118.25`;
  const ready = await (await fetch(url)).json();
  assert.equal(ready.status, "ready");
  assert.equal(ready.cells.features.length, 784);
  assert.equal(ready.prediction.scoreKind, "sample_relative");
  assert.deepEqual(ready.bundle.location, modelBundle().location);
  fail = true;
  const fallback = await (await fetch(url)).json();
  assert.equal(fallback.status, "observed");
  assert.equal(fallback.inference.status, "unavailable");
  assert.equal(fallback.detections.features.length, 2);
  assert.equal(fallback.cells.features.length, 0);
  assert.ok(!JSON.stringify(fallback).includes("private URL"));
});

test("health probes the model service and tiles request the 24 h window the model needs", async t => {
  const { createServer } = await import("node:http");
  let modelUp = true;
  const model = createServer((_req, res) => {
    res.writeHead(modelUp ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify(modelUp ? { status: "ok", modelVersion: "fixture-model" } : { detail: "starting" }));
  }).listen(0, "127.0.0.1");
  await new Promise(resolve => model.once("listening", resolve));
  const modelAddress = model.address();
  assert.ok(modelAddress && typeof modelAddress !== "string");
  const config = readConfig({
    FIRMS_MAP_KEY: "test", EARTHDATA_TOKEN: "test", DAYMET_START_DATE: "2020-07-01", DAYMET_END_DATE: "2020-07-03",
    INFERENCE_URL: `http://127.0.0.1:${modelAddress.port}`,
  });
  const requested: Array<number | undefined> = [];
  const app = createApp(config, async (_lat, _long, options) => {
    requested.push(options.forecastHours);
    return modelBundle();
  }, async () => result());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  t.after(() => { model.close(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const up = await (await fetch(`${base}/health`)).json();
  assert.equal(up.inference, "ready");
  assert.equal(up.modelVersion, "fixture-model");
  modelUp = false;
  assert.equal((await (await fetch(`${base}/health`)).json()).inference, "unreachable");
  assert.equal((await (await fetch(`${base}/tiles?lat=34.05&long=-118.25&forecastHours=6`)).json()).status, "ready");
  await fetch(`${base}/tiles?lat=34.05&long=-118.25&forecastHours=48`);
  assert.deepEqual(requested, [24, 48]);
});
