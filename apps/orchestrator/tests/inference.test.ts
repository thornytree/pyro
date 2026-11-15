import assert from "node:assert/strict";
import { test } from "node:test";
import { createInference, inferenceHealth } from "../src/inference.ts";
import { toTileResponse } from "../src/tile-response.ts";
import { makeBundle } from "./fixtures/bundle.ts";
import { occurrenceBody, spreadBody } from "./fixtures/inference.ts";

const config = { url: "http://inference.test", timeoutMs: 500 };
const bundle = makeBundle();

type Reply = { status?: number; body: unknown } | Error;

/** A fetch that answers per path and records what was sent. */
function fakeFetch(replies: Record<string, Reply>) {
  const calls: Array<{ path: string; method: string; body: Record<string, unknown> | null }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    calls.push({ path, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    const reply = replies[path];
    if (!reply) throw new TypeError("fetch failed");
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

test("is switched off without a URL and calls nothing", async () => {
  const { fetchImpl, calls } = fakeFetch({});
  const result = await createInference({ url: null, timeoutMs: 500 }, fetchImpl)(bundle);
  assert.deepEqual(result, { status: "not_configured" });
  assert.equal(calls.length, 0);
  assert.equal(await inferenceHealth({ url: null, timeoutMs: 500 }, fetchImpl), "not_connected");
  const tile = toTileResponse(bundle, result);
  assert.equal(tile.status, "observed");
  assert.deepEqual(tile.inference, { status: "not_configured" });
});

test("posts the bundle without Daymet to both models and merges their output", async () => {
  const { fetchImpl, calls } = fakeFetch({
    "/predict": { body: occurrenceBody(bundle) }, "/spread": { body: spreadBody(bundle) },
  });
  const result = await createInference(config, fetchImpl)(bundle);
  assert.deepEqual(calls.map(call => `${call.method} ${call.path}`).sort(), ["POST /predict", "POST /spread"]);
  for (const call of calls) {
    assert.ok(call.body && !("historical_weather" in call.body));
    assert.deepEqual(call.body.location, bundle.location);
    assert.ok("weather_grid" in call.body && "terrain" in call.body && "vegetation" in call.body && "fire" in call.body);
  }
  assert.ok(bundle.historical_weather, "the caller's bundle is left intact");

  const tile = toTileResponse(bundle, result);
  assert.equal(tile.status, "ready");
  assert.equal(tile.updatedAt, "2026-11-15T09:00:00+00:00");
  assert.equal(tile.cells.features.length, bundle.weather_grid.rows * bundle.weather_grid.columns);
  assert.deepEqual(tile.cells.features[0]?.properties, { probability: 0.0312, uncertainty: 0.05, riskScore: 0.7, detections: 0 });
  assert.deepEqual(tile.spread.features.map(feature => feature.properties.horizonHours), [6, 12, 24]);
  assert.equal(tile.drivers?.windFromDeg, 270);
  assert.equal(tile.model?.predictionDate, "2026-11-15");
  assert.equal(tile.model?.baseRate, 0.01417);
  assert.deepEqual(tile.model?.spread, {
    status: "ok", version: "spread-test", fire: { detections: 2, cells: 1, sensors: 2, frpMaxMw: 12 },
    neighbourCellProbability: 0.008, meanSpreadKmPerDay: 0.16,
  });
  assert.deepEqual(tile.inference, { status: "ok" });
  assert.equal(tile.detections.features.length, 2);
  assert.equal(tile.bundle, bundle);
});

test("a region with no confirmed fire is ready with an empty spread", async () => {
  const { fetchImpl } = fakeFetch({
    "/predict": { body: occurrenceBody(bundle) },
    "/spread": { body: { status: "no_confirmed_fire", modelVersion: "spread-test", updatedAt: "2026-11-15T09:00:00+00:00" } },
  });
  const tile = toTileResponse(bundle, await createInference(config, fetchImpl)(bundle));
  assert.equal(tile.status, "ready");
  assert.deepEqual(tile.spread.features, []);
  assert.equal(tile.drivers, null);
  assert.deepEqual(tile.model?.spread, { status: "no_confirmed_fire", version: "spread-test" });
});

test("keeps the probabilities when only the spread model fails", async () => {
  const { fetchImpl } = fakeFetch({
    "/predict": { body: occurrenceBody(bundle) }, "/spread": { status: 500, body: { detail: "boom" } },
  });
  const result = await createInference(config, fetchImpl)(bundle);
  assert.equal(result.status, "ok");
  const tile = toTileResponse(bundle, result);
  assert.equal(tile.status, "ready");
  assert.equal(tile.cells.features.length, 784);
  assert.deepEqual(tile.spread.features, []);
  assert.deepEqual(tile.model?.spread, { status: "unavailable", message: "Inference /spread returned HTTP 500: boom" });
});

test("falls back to observations and says why when the occurrence model fails", async () => {
  const cases: Array<[Reply | undefined, string, RegExp]> = [
    [{ status: 503, body: { detail: "occurrence.joblib not found.\nTrain the models first" } }, "models_missing", /HTTP 503: occurrence\.joblib not found\. Train/],
    [{ status: 422, body: { detail: "Invalid dataBundle: BundleError('x')" } }, "bundle_rejected", /HTTP 422/],
    [{ status: 500, body: "Internal Server Error" }, "service_error", /HTTP 500$/],
    [{ body: { cells: { type: "FeatureCollection", features: [] } } }, "bad_response", /unexpected response/],
    [{ body: { ...occurrenceBody(bundle), cells: occurrenceBody(bundle, { probability: 1.5 }).cells } }, "bad_response", /unexpected response/],
    [undefined, "unreachable", /not reachable at http:\/\/inference\.test/],
    [Object.assign(new Error("timed out"), { name: "TimeoutError" }), "timeout", /within 500 ms/],
  ];
  for (const [reply, reason, message] of cases) {
    const { fetchImpl } = fakeFetch({ ...(reply ? { "/predict": reply } : {}), "/spread": { body: spreadBody(bundle) } });
    const result = await createInference(config, fetchImpl)(bundle);
    assert.equal(result.status, "failed");
    assert.equal(result.status === "failed" && result.reason, reason);
    const tile = toTileResponse(bundle, result);
    assert.equal(tile.status, "observed");
    assert.equal(tile.updatedAt, null);
    assert.deepEqual(tile.cells.features, []);
    assert.deepEqual(tile.spread.features, []);
    assert.equal(tile.model, null);
    assert.equal(tile.inference.status, "failed");
    assert.match(tile.inference.status === "failed" ? tile.inference.message : "", message);
    assert.equal(tile.detections.features.length, 2);
  }
});

test("reports inference health", async () => {
  const health = (replies: Record<string, Reply>) => inferenceHealth(config, fakeFetch(replies).fetchImpl);
  assert.equal(await health({ "/health": { body: { status: "ok", models: {} } } }), "connected");
  assert.equal(await health({ "/health": { body: { status: "models_missing", models: {} } } }), "models_missing");
  assert.equal(await health({}), "unreachable");
});
