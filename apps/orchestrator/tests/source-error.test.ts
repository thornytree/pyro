import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchSource, SourceFetchError } from "../src/fan-out/source-error.ts";
import { retryWeatherRequest } from "../src/fan-out/meteo.ts";

test("classifies nested provider failures without exposing their text or secrets", () => {
  const error = new SourceFetchError("LANDFIRE", new Error("https://provider/secret-key", {
    cause: new Error("Raster service returned HTTP 429 with secret-key"),
  }));
  assert.equal(error.reason, "RATE_LIMITED");
  assert.equal(error.upstreamStatus, 429);
  assert.ok(!error.message.includes("secret-key"));
  assert.equal(new SourceFetchError("Daymet", new Error("Daymet returned HTTP 401")).reason, "AUTHENTICATION_FAILED");
  const timeout = new Error("connect failed");
  timeout.name = "ConnectTimeoutError";
  assert.equal(new SourceFetchError("Open-Meteo", new Error("fetch failed", { cause: timeout })).reason, "TIMEOUT");
});

test("tags the failing source and keeps successful results unchanged", async () => {
  assert.equal(await fetchSource("FIRMS", async () => 42), 42);
  await assert.rejects(fetchSource("Daymet", async () => { throw new Error("bad data"); }),
    (error: unknown) => error instanceof SourceFetchError && error.source === "Daymet");
});

test("retries a transient weather connection failure once, but not data errors", async () => {
  let calls = 0;
  assert.equal(await retryWeatherRequest(async () => {
    if (++calls === 1) throw new TypeError("fetch failed");
    return 42;
  }), 42);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(retryWeatherRequest(async () => { calls++; throw new Error("invalid weather data"); }), /invalid/);
  assert.equal(calls, 1);
});
