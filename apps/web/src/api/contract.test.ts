import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../../../orchestrator/src/app";
import { readConfig } from "../../../orchestrator/src/config";
import { makeBundle } from "../../../orchestrator/tests/fixtures/bundle";
import { createStateHeatmapService } from "../../../orchestrator/src/state-heatmap";
import { createTileFetcher, createStateHeatmapFetcher } from "./client";
import { LIVE } from "../lib/mode";

// Actual HTTP and both sides' real parsing/serialization; only upstream retrieval is stubbed.
describe("web selection → Express trigger → observation bundle", () => {
  let server: Server;
  let baseUrl: string;
  const trigger = vi.fn(async (lat: number, long: number) =>
    makeBundle({ latitude: lat, longitude: long }));
  const fire = vi.fn(async () => ({ fire: { detections: makeBundle({ latitude: 37, longitude: -120 }).fire!.detections } }));
  const config = readConfig({
    FIRMS_MAP_KEY: "test", EARTHDATA_TOKEN: "test",
    DAYMET_START_DATE: "2020-07-01", DAYMET_END_DATE: "2020-07-03",
  });

  beforeAll(async () => {
    // No model is configured, so the state route asks only FIRMS (stubbed) for detections.
    const stateHeatmap = createStateHeatmapService(config, {
      fire,
      forecast: async () => { throw new Error("unexpected weather request"); },
      predict: async () => { throw new Error("unexpected inference request"); },
    });
    server = createApp(config, trigger, undefined, stateHeatmap).listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve); server.once("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test listener address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(() => new Promise<void>((resolve, reject) => {
    if (!server?.listening) { resolve(); return; }
    server.close(error => error ? reject(error) : resolve());
  }));

  it("returns a correctly centered 300-square-mile bundle for each selected point", async () => {
    const fetcher = createTileFetcher(baseUrl);
    for (const point of [{ lat: 34.05, long: -118.25 }, { lat: 43.62, long: -116.2 }]) {
      const result = await fetcher(point, LIVE);
      expect(trigger).toHaveBeenLastCalledWith(point.lat, point.long, config.defaults);
      expect(result.status).toBe("observed");
      expect(result.bundle?.location).toEqual({ latitude: point.lat, longitude: point.long });
      expect(result.detections.features[0]?.geometry.coordinates).toEqual([point.long, point.lat]);
      const [west, south, east, north] = result.bounds;
      const areaKm2 = 6371.0088 ** 2 * (east - west) * Math.PI / 180 *
        (Math.sin(north * Math.PI / 180) - Math.sin(south * Math.PI / 180));
      expect(areaKm2 / 1.609344 ** 2).toBeCloseTo(300, 6);
      expect(result.bundle?.weather_grid.cells).toHaveLength(784);
      expect(result.cells.features).toHaveLength(0);
      expect(result.updatedAt).toBeNull();
    }
  });

  it("loads a state's detections once and serves repeats from the server cache", async () => {
    const before = trigger.mock.calls.length;
    const fetcher = createStateHeatmapFetcher(baseUrl);
    const heatmap = await fetcher("06", LIVE);
    expect(heatmap).toMatchObject({ stateId: "06", status: "observed", grid: null, inference: { status: "not_configured" } });
    expect(heatmap?.detections.features.map((f) => f.geometry.coordinates)).toEqual([[-120, 37], [-120, 37]]);
    const [west, south, east, north] = heatmap!.bounds;
    expect(west < -120 && east > -120 && south < 37 && north > 37).toBe(true);
    await fetcher("06", LIVE);
    expect(fire).toHaveBeenCalledTimes(1);
    // Opening a state never triggers the regional five-provider fetch.
    expect(trigger.mock.calls.length).toBe(before);
    await expect(fetcher("02", LIVE)).rejects.toMatchObject({ status: 404, code: "UNKNOWN_STATE" });
  });

  it("reports backend coordinate errors without invoking the trigger", async () => {
    const before = trigger.mock.calls.length;
    await expect(createTileFetcher(baseUrl)({ lat: 0, long: 0 }, LIVE))
      .rejects.toMatchObject({ status: 422, code: "OUTSIDE_SUPPORTED_AREA" });
    expect(trigger.mock.calls.length).toBe(before);
  });
});
