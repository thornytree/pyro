import assert from "node:assert/strict";
import { test } from "node:test";
import getFireAttributes, { createFireBounds, normalizeFireAttributes } from "../src/fan-out/firms.ts";
import type { FirmsRow } from "../src/fan-out/firms.ts";

const row: FirmsRow = {
  latitude: "34.05", longitude: "-118.25", acq_date: "2026-11-14", acq_time: "0035",
  satellite: "Terra", confidence: "80", frp: "12.5", scan: "1", track: "1.2",
};
const header = "latitude,longitude,acq_date,acq_time,satellite,confidence,frp,scan,track";

test("normalizes MODIS and VIIRS without conflating confidence scales or sensors", () => {
  const { fire } = normalizeFireAttributes([
    { source: "MODIS_NRT", rows: [row, row] },
    { source: "VIIRS_SNPP_NRT", rows: [{ ...row, satellite: "N", confidence: "n", acq_time: 5 }] },
  ]);
  assert.equal(fire.detections.length, 2);
  const [viirs, modis] = fire.detections;
  assert.equal(viirs?.observation_time, "2026-11-14T00:05:00.000Z");
  assert.deepEqual(viirs?.confidence, { kind: "category", value: "nominal" });
  assert.deepEqual(modis?.confidence, { kind: "percent", value: 80 });
  assert.equal(modis?.frp_mw, 12.5);
  assert.deepEqual(modis?.location, { latitude: 34.05, longitude: -118.25 });
});

test("rejects invalid observations instead of inventing values", () => {
  for (const changes of [
    { frp: "" }, { latitude: "NaN" }, { longitude: 181 }, { acq_date: "2026-02-30" },
    { acq_time: "2400" }, { confidence: 101 },
  ]) {
    assert.throws(() => normalizeFireAttributes([{ source: "MODIS_NRT", rows: [{ ...row, ...changes }] }]));
  }
  for (const confidence of ["invalid", "constructor", "80"]) {
    assert.throws(() => normalizeFireAttributes([
      { source: "VIIRS_SNPP_NRT", rows: [{ ...row, confidence }] },
    ]));
  }
  assert.deepEqual(normalizeFireAttributes([]), { fire: { detections: [] } });
});

test("fetches four feeds concurrently and handles quoted CSV and header-only results", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    calls.push(url);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 4);
    const csv = url.includes("/MODIS_NRT/")
      ? `${header}\r\n34.05,-118.25,2026-11-14,0035,"Terra",80,12.5,1,1.2\r\n`
      : `${header}\n`;
    return new Response(csv);
  });
  const result = await getFireAttributes(34.05, -118.25, { mapKey: "test-key", days: 2 });
  assert.equal(result.fire.detections.length, 1);
  const bounds = createFireBounds(34.05, -118.25);
  assert.ok(calls.every(url => url.endsWith(`/${bounds.west},${bounds.south},${bounds.east},${bounds.north}/2`)));
});

test("fails on HTTP errors, blank bodies, malformed headers and provider errors", async (t) => {
  for (const [body, status] of [["unavailable", 503], ["", 200], ["Invalid MAP_KEY", 200], ["latitude,longitude\n", 200]] as const) {
    const mock = t.mock.method(globalThis, "fetch", async () => new Response(body, { status }));
    await assert.rejects(getFireAttributes(34.05, -118.25, { mapKey: "test-key" }), /FIRMS/);
    mock.mock.restore();
  }
  t.mock.method(globalThis, "fetch", async () => { throw new Error("URL containing secret-key"); });
  await assert.rejects(getFireAttributes(34.05, -118.25, { mapKey: "secret-key" }), error => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes("secret-key"));
    return true;
  });
});

test("validates coordinates and day range before fetching", async () => {
  await assert.rejects(getFireAttributes(91, 0, { mapKey: "test" }), /latitude/);
  await assert.rejects(getFireAttributes(34.05, -118.25, { days: 6, mapKey: "test" }), /day range/);
  await assert.rejects(getFireAttributes(34.05, -118.25, { mapKey: "" }), /FIRMS_MAP_KEY/);
});


test("search boxes stay centered and cover 300 square miles at different latitudes", () => {
  for (const lat of [0, 34.05, 60, -45]) {
    const bounds = createFireBounds(lat, -100);
    assert.ok(Math.abs((bounds.north + bounds.south) / 2 - lat) < 1e-10);
    assert.ok(Math.abs((bounds.west + bounds.east) / 2 + 100) < 1e-10);
    const radians = Math.PI / 180;
    const areaKm2 = 6371.0088 ** 2 * (bounds.east - bounds.west) * radians *
      (Math.sin(bounds.north * radians) - Math.sin(bounds.south * radians));
    assert.ok(Math.abs(areaKm2 / 1.609344 ** 2 - 300) < 1e-6);
  }
  assert.throws(() => createFireBounds(90, 0), /pole/);
  assert.throws(() => createFireBounds(0, 180), /antimeridian/);
  assert.throws(() => createFireBounds(0, NaN), /longitude/);
});
