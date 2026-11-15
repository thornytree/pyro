import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.ts";
import { readConfig } from "../src/config.ts";
import { SourceFetchError } from "../src/fan-out/source-error.ts";
import type { FireDetection } from "../src/fan-out/types.ts";
import type { ScoredPoint } from "../src/inference/client.ts";
import { buildStateHeatmap, createStateHeatmapService, planStateGrid } from "../src/state-heatmap.ts";
import type { StateHeatmapDeps } from "../src/state-heatmap.ts";
import { stateOutline } from "../src/states.ts";

const env = {
  FIRMS_MAP_KEY: "private-firms", EARTHDATA_TOKEN: "private-earthdata",
  DAYMET_START_DATE: "2020-07-01", DAYMET_END_DATE: "2020-07-31",
};
const withModel = readConfig({ ...env, INFERENCE_URL: "http://model.test", STATE_GRID_MAX_POINTS: "120" });
const start = "2026-11-14T12:00:00.000Z";
const weather = {
  temperature: 20, humidity: 50, wind_speed_kph: 10, wind_direction: 270, precipitation_mm: 0,
  wind_gusts_kph: 15, vapour_pressure_deficit_kpa: 1, shortwave_radiation_w_m2: 300,
};
const detection = (latitude: number, longitude: number): FireDetection => ({
  source: "MODIS_NRT", instrument: "MODIS", satellite: "Terra", location: { latitude, longitude }, tile_id: null,
  observation_time: start, frp_mw: 12, scan_km: 1, track_km: 1, confidence: { kind: "percent", value: 80 },
});

function stubs(overrides: Partial<StateHeatmapDeps> = {}) {
  const calls = { forecast: 0, fire: 0, predict: 0, points: [] as ScoredPoint[] };
  const deps: StateHeatmapDeps = {
    forecast: async (points, hours) => {
      calls.forecast++;
      assert.equal(hours, 24);
      return points.map(point => ({
        requested_location: point, source_location: point, elevation_m: 100,
        hourly: Array.from({ length: 24 }, (_, hour) => ({ ...weather, time: new Date(Date.parse(start) + hour * 3600000).toISOString() })),
      }));
    },
    // One detection in Nevada, one in the Pacific: both are inside California's bounding box.
    fire: async () => { calls.fire++; return { fire: { detections: [detection(37, -120), detection(39.5, -117), detection(33, -123)] } }; },
    predict: async points => {
      calls.predict++; calls.points = points;
      return {
        updatedAt: start, probability: points.map((_, index) => index / points.length), uncertainty: points.map(() => 0.2),
        prediction: {
          modelVersion: "fixture", target: "any_firms_detection_in_10km_cell_day", scoreKind: "sample_relative",
          horizonHours: 24, nativeResolutionKm: 10, nativeCellCount: points.length,
          uncertaintyKind: "twice_bootstrap_ensemble_standard_deviation", experimental: true,
          windowStart: start, windowEnd: new Date(Date.parse(start) + 86400000).toISOString(),
        },
      };
    },
    ...overrides,
  };
  return { deps, calls };
}

test("knows CONUS states only, with plausible extents", () => {
  const california = stateOutline("06")!;
  assert.equal(california.name, "California");
  assert.ok(Math.abs(california.areaKm2 - 410_000) < 15_000, String(california.areaKm2));
  assert.ok(california.contains(34.05, -118.25) && !california.contains(39.5, -117) && !california.contains(33, -123));
  for (const fips of ["02", "15", "72", "99", "6"]) assert.equal(stateOutline(fips), undefined);
});

test("plans a grid within the point budget that covers the state and a one-cell rim", () => {
  for (const [fips, budget] of [["06", 300], ["48", 300], ["48", 60], ["44", 300], ["11", 300]] as const) {
    const state = stateOutline(fips)!;
    const plan = planStateGrid(state, budget);
    assert.ok(plan.points.length > 0 && plan.points.length <= budget, `${fips}: ${plan.points.length}`);
    assert.equal(plan.pointIndex.length, plan.rows * plan.columns);
    assert.equal(plan.pointIndex.filter(index => index >= 0).length, plan.points.length);
    assert.ok(plan.spacingKm >= 10);
    // Every cell whose centre is in the state is sampled.
    plan.pointIndex.forEach((index, cell) => {
      const latitude = state.bounds.north - (Math.floor(cell / plan.columns) + 0.5) * (state.bounds.north - state.bounds.south) / plan.rows;
      const longitude = state.bounds.west + (cell % plan.columns + 0.5) * (state.bounds.east - state.bounds.west) / plan.columns;
      if (state.contains(latitude, longitude)) assert.ok(index >= 0);
      if (index >= 0) assert.deepEqual(plan.points[index], { latitude, longitude });
    });
  }
  // Small states are sampled at the model's native 10 km; large ones are coarser.
  assert.equal(planStateGrid(stateOutline("44")!, 300).spacingKm, 10);
  assert.ok(planStateGrid(stateOutline("48")!, 300).spacingKm > 40);
  // Rhode Island's box is mostly sampled; California's leaves the ocean and Nevada out.
  const california = planStateGrid(stateOutline("06")!, 300);
  assert.ok(california.points.length < 0.75 * california.rows * california.columns);
});

test("scores the planned points and lays them out on the grid with in-state detections", async () => {
  const { deps, calls } = stubs();
  const heatmap = await buildStateHeatmap(stateOutline("06")!, withModel, deps);
  assert.equal(heatmap.status, "ready");
  assert.equal(heatmap.stateId, "06");
  assert.equal(heatmap.updatedAt, start);
  const grid = heatmap.grid!;
  assert.equal(grid.probability.length, grid.rows * grid.columns);
  assert.equal(grid.probability.filter(value => value !== null).length, calls.points.length);
  assert.ok(calls.points.length <= 120 && grid.probability.includes(null));
  assert.deepEqual(grid.uncertainty.map(value => value === null), grid.probability.map(value => value === null));
  assert.equal(calls.points[0]?.hourly.length, 24);
  assert.equal(heatmap.detections.features.length, 1);
  assert.deepEqual(heatmap.detections.features[0]?.geometry.coordinates, [-120, 37]);
  assert.equal(heatmap.prediction?.scoreKind, "sample_relative");
  const { west, south, east, north } = stateOutline("06")!.bounds;
  assert.deepEqual(heatmap.bounds, [west, south, east, north]);
});

test("spends no weather requests without a model and degrades when FIRMS or inference fails", async () => {
  const noModel = stubs();
  const observed = await buildStateHeatmap(stateOutline("06")!, readConfig(env), noModel.deps);
  assert.deepEqual([observed.status, observed.grid, observed.inference.status], ["observed", null, "not_configured"]);
  assert.deepEqual([noModel.calls.forecast, noModel.calls.predict, observed.detections.features.length], [0, 0, 1]);

  const broken = stubs({
    fire: async () => { throw new Error("FIRMS MODIS_NRT returned HTTP 429. https://firms.test/private-firms"); },
    predict: async () => { throw new Error("private model details"); },
  });
  const degraded = await buildStateHeatmap(stateOutline("06")!, withModel, broken.deps);
  assert.deepEqual([degraded.status, degraded.grid, degraded.inference.status], ["observed", null, "unavailable"]);
  assert.equal(degraded.sourceFailures[0]?.reason, "RATE_LIMITED");
  assert.ok(!JSON.stringify(degraded).includes("private"));

  const noWeather = stubs({ forecast: async () => { throw new Error("Open-Meteo returned HTTP 429"); } });
  await assert.rejects(buildStateHeatmap(stateOutline("06")!, withModel, noWeather.deps), SourceFetchError);
});

test("serves one cached heat map per state over HTTP and reports a weather failure", async t => {
  const { deps, calls } = stubs();
  let weatherDown = false;
  const forecast = deps.forecast;
  deps.forecast = async (points, hours) => {
    if (weatherDown) throw new Error("Open-Meteo returned HTTP 503. token=private-earthdata");
    return forecast(points, hours);
  };
  const app = createApp(withModel, undefined, undefined, createStateHeatmapService(withModel, deps));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;

  const [first, second] = await Promise.all([fetch(`${base}/states/06/heatmap`), fetch(`${base}/states/06/heatmap`)]);
  assert.equal(first.status, 200);
  assert.match(first.headers.get("cache-control") ?? "", /^public, max-age=\d+$/);
  assert.equal(first.headers.get("content-encoding"), "gzip");
  assert.deepEqual(await first.json(), await second.json());
  await fetch(`${base}/states/06/heatmap`);
  assert.deepEqual([calls.forecast, calls.fire, calls.predict], [1, 1, 1]);

  await fetch(`${base}/states/32/heatmap`);
  assert.equal(calls.predict, 2);
  assert.equal((await fetch(`${base}/states/02/heatmap`)).status, 404);
  assert.equal((await fetch(`${base}/states/abc/heatmap`)).status, 404);

  weatherDown = true;
  const failed = await fetch(`${base}/states/41/heatmap`);
  assert.equal(failed.status, 502);
  const body = await failed.text();
  assert.ok(body.includes("Open-Meteo") && !body.includes("private-"));
  weatherDown = false;
  assert.equal((await fetch(`${base}/states/41/heatmap`)).status, 200); // The failure was not cached.
});
