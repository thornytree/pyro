import assert from "node:assert/strict";
import { test } from "node:test";
import { CONUS_FRAME, fetchFirmsNationwide, normalizeFireAttributes } from "../src/fan-out/firms.ts";
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

test("fetches all five feeds nationwide and keeps only detections inside the tile frame", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    calls.push(url);
    const csv = url.includes("/MODIS_NRT/")
      ? `${header}\r\n34.05,-118.25,2026-11-14,0035,"Terra",80,12.5,1,1.2\r\n10,10,2026-11-14,0035,Terra,80,1,1,1\r\n`
      : url.includes("/LANDSAT_NRT/")
        ? "latitude,longitude,scan,track,acq_date,acq_time,satellite,instrument,confidence,daynight\n34.1,-118.3,4164,4962,2026-11-14,1825,L9,OLI-2,H,D\n"
        : `${header}\n`;
    return new Response(csv);
  });
  const result = await fetchFirmsNationwide({ mapKey: "test-key", days: 2 });
  assert.equal(calls.length, 5);
  const { west, south, east, north } = CONUS_FRAME;
  assert.ok(calls.every(url => url.endsWith(`/${west},${south},${east},${north}/2`)));
  assert.equal(result.detections.length, 2);
  const landsat = result.detections.find(d => d.source === "LANDSAT_NRT");
  assert.equal(landsat?.frp_mw, null);
  assert.equal(landsat?.scan_km, 0.03);
  assert.equal(landsat?.tile_id, "r24c07");
});

test("fails on HTTP errors, blank bodies, malformed headers and provider errors", async (t) => {
  for (const [body, status] of [["unavailable", 503], ["", 200], ["Invalid MAP_KEY", 200], ["latitude,longitude\n", 200]] as const) {
    const mock = t.mock.method(globalThis, "fetch", async () => new Response(body, { status }));
    await assert.rejects(fetchFirmsNationwide({ mapKey: "test-key" }), /FIRMS/);
    mock.mock.restore();
  }
  t.mock.method(globalThis, "fetch", async () => { throw new Error("URL containing secret-key"); });
  await assert.rejects(fetchFirmsNationwide({ mapKey: "secret-key" }), error => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes("secret-key"));
    return true;
  });
});

test("validates day range and key before fetching", async () => {
  await assert.rejects(fetchFirmsNationwide({ days: 6, mapKey: "test" }), /day range/);
  await assert.rejects(fetchFirmsNationwide({ mapKey: "" }), /FIRMS_MAP_KEY/);
});
