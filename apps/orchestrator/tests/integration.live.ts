/**
 * End-to-end contract check against a running Python inference service:
 * Express (stubbed sources) -> POST /predict -> orchestrator validation of the model contract.
 * Start inference first, then: npm run test:integration --workspace @pyro/orchestrator
 */
import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";
import { readConfig } from "../src/config.ts";
import { makeBundle } from "./fixtures/bundle.ts";

const inferenceUrl = process.env.INFERENCE_URL ?? "http://127.0.0.1:8000";
const config = readConfig({
  FIRMS_MAP_KEY: "unused", EARTHDATA_TOKEN: "unused", DAYMET_START_DATE: "2020-07-01", DAYMET_END_DATE: "2020-07-03",
  INFERENCE_URL: inferenceUrl,
});
const app = createApp(config, async (latitude, longitude) => {
  const bundle = makeBundle({ latitude, longitude });
  const start = Math.floor(Date.now() / 3600000) * 3600000;
  bundle.weather_grid.samples[0]!.hourly = Array.from({ length: 24 }, (_, hour) => ({
    ...bundle.weather, time: new Date(start + hour * 3600000).toISOString(),
  }));
  return bundle;
});
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
} finally {
  server.close();
}
