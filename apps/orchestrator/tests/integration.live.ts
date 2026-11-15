/**
 * End-to-end contract check against a running Python inference service:
 * Express (stubbed sources) -> POST /predict and POST /predict/points -> orchestrator
 * validation of the model contract, for a clicked region and a statewide heat map.
 * Start inference first, then: npm run test:integration --workspace @pyro/orchestrator
 */
import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";
import { readConfig } from "../src/config.ts";
import { createStateHeatmapService } from "../src/state-heatmap.ts";
import { predictPoints } from "../src/inference/client.ts";
import { makeBundle } from "./fixtures/bundle.ts";

const inferenceUrl = process.env.INFERENCE_URL ?? "http://127.0.0.1:8000";
const config = readConfig({
  FIRMS_MAP_KEY: "unused", EARTHDATA_TOKEN: "unused", DAYMET_START_DATE: "2020-07-01", DAYMET_END_DATE: "2020-07-03",
  INFERENCE_URL: inferenceUrl,
});
const start = Math.floor(Date.now() / 3600000) * 3600000;
const hourly = (weather: ReturnType<typeof makeBundle>["weather"]) => Array.from({ length: 24 }, (_, hour) => ({
  ...weather, time: new Date(start + hour * 3600000).toISOString(),
}));
// Stubbed weather and FIRMS; the scoring is the real service's.
const stateHeatmap = createStateHeatmapService(config, {
  forecast: async points => points.map(point => ({
    requested_location: point, source_location: point, elevation_m: 500, hourly: hourly(makeBundle().weather),
  })),
  fire: async () => ({ fire: { detections: [] } }),
  predict: predictPoints,
});
const app = createApp(config, async (latitude, longitude) => {
  const bundle = makeBundle({ latitude, longitude });
  bundle.weather_grid.samples[0]!.hourly = hourly(bundle.weather);
  return bundle;
}, undefined, stateHeatmap);
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
try {
  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.inference, "ready", `Inference service at ${inferenceUrl} is not reachable.`);
  const tile = await (await fetch(`${base}/tiles?lat=39.5&long=-121.5`)).json();
  assert.equal(tile.status, "ready");
  assert.equal(tile.cells.features.length, 784);
  assert.equal(tile.prediction.modelVersion, health.modelVersion);
  console.log(`ok: ${tile.cells.features.length} cells from ${health.modelVersion}`);
  const began = Date.now();
  const heatmap = await (await fetch(`${base}/states/06/heatmap`)).json();
  assert.equal(heatmap.status, "ready");
  assert.equal(heatmap.prediction.modelVersion, health.modelVersion);
  const scored = heatmap.grid.probability.filter((value: number | null) => value !== null);
  assert.ok(scored.length > 0 && scored.length <= config.stateHeatmap.maxPoints);
  assert.equal(heatmap.grid.probability.length, heatmap.grid.rows * heatmap.grid.columns);
  console.log(`ok: California heat map, ${scored.length} points on a ${heatmap.grid.rows} x ${heatmap.grid.columns} grid ` +
    `every ${heatmap.grid.spacingKm} km, scores ${Math.min(...scored)} to ${Math.max(...scored)}, in ${Date.now() - began} ms`);
} finally {
  server.close();
}
