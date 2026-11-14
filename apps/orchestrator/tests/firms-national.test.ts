import assert from "node:assert/strict";
import { test } from "node:test";
import { CONUS_FRAME, fetchFirmsNationwide } from "../src/fan-out/firms.ts";

const header = "latitude,longitude,acq_date,acq_time,satellite,confidence,frp,scan,track";

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

