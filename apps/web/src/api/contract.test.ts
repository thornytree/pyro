import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../../../orchestrator/src/app";
import { readConfig } from "../../../orchestrator/src/config";
import { makeBundle } from "../../../orchestrator/tests/fixtures/bundle";
import { createTileFetcher, createStatePreviewFetcher } from "./client";
import { LIVE } from "../lib/mode";

// Actual HTTP and both sides' real parsing/serialization; only upstream retrieval is stubbed.
describe("web selection → Express trigger → observation bundle", () => {
  let server: Server;
  let baseUrl: string;
  const trigger = vi.fn(async (lat: number, long: number) =>
    makeBundle({ latitude: lat, longitude: long }));
  const config = readConfig({
    FIRMS_MAP_KEY: "test", EARTHDATA_TOKEN: "test",
    DAYMET_START_DATE: "2020-07-01", DAYMET_END_DATE: "2020-07-03",
  });

  beforeAll(async () => {
    server = createApp(config, trigger).listen(0, "127.0.0.1");
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

  it("accepts the empty real state preview without activating retrieval", async () => {
    const before = trigger.mock.calls.length;
    const preview = await createStatePreviewFetcher(baseUrl)("06", LIVE);
    expect(preview.stateId).toBe("06");
    expect(preview.tiles.features).toEqual([]);
    expect(trigger.mock.calls.length).toBe(before);
  });

  it("reports backend coordinate errors without invoking the trigger", async () => {
    const before = trigger.mock.calls.length;
    await expect(createTileFetcher(baseUrl)({ lat: 0, long: 0 }, LIVE))
      .rejects.toMatchObject({ status: 422, code: "OUTSIDE_SUPPORTED_AREA" });
    expect(trigger.mock.calls.length).toBe(before);
  });
});
