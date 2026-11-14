import { describe, expect, it, vi } from "vitest";
import { ApiError, createStatePreviewFetcher, createTileFetcher } from "./client";
import { LIVE } from "../lib/mode";
import { buildMockTile } from "./mock";

const point = { lat: 39.5, long: -121.5 };
const tile = buildMockTile(point, new Date("2026-11-14T00:00:00Z"));

function fetchReturning(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () =>
    new Response(JSON.stringify(body), { status }),
  );
}

describe("createTileFetcher", () => {
  it("requests /tiles with lat and long and returns the tile", async () => {
    const fetchImpl = fetchReturning(tile);
    const result = await createTileFetcher("http://api.test", fetchImpl)(point, LIVE);

    expect(result).toEqual(tile);
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe("http://api.test/tiles");
    expect(url.searchParams.get("lat")).toBe("39.5");
    expect(url.searchParams.get("long")).toBe("-121.5");
  });

  it("asks the read-only /history/tiles route for a past day", async () => {
    const fetchImpl = fetchReturning(tile);
    await createTileFetcher("http://api.test", fetchImpl)(point, {
      kind: "historical",
      date: "2021-08-20",
    });
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/history/tiles");
    expect(url.searchParams.get("date")).toBe("2021-08-20");
    expect(url.searchParams.get("lat")).toBe("39.5");
  });

  it("rejects a malformed spread field", async () => {
    const fetcher = createTileFetcher("http://api.test", fetchReturning({ ...tile, spread: [] }));
    await expect(fetcher(point, LIVE)).rejects.toBeInstanceOf(ApiError);
  });

  it("passes the abort signal through", async () => {
    const fetchImpl = fetchReturning(tile);
    const controller = new AbortController();
    await createTileFetcher("http://api.test", fetchImpl)(point, LIVE, controller.signal);
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it("throws ApiError with the status on a non-2xx response", async () => {
    const fetcher = createTileFetcher("http://api.test", fetchReturning({}, 503));
    await expect(fetcher(point, LIVE)).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
    });
  });

  it("rejects a body that does not match the tile schema", async () => {
    const fetcher = createTileFetcher(
      "http://api.test",
      fetchReturning({ ...tile, status: "done" }),
    );
    await expect(fetcher(point, LIVE)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("createStatePreviewFetcher", () => {
  const preview = {
    stateId: "06",
    updatedAt: null,
    tiles: { type: "FeatureCollection", features: [] },
  };

  it("requests /states/{fips}/preview and returns the preview", async () => {
    const fetchImpl = fetchReturning(preview);
    const result = await createStatePreviewFetcher("http://api.test", fetchImpl)("06", LIVE);
    expect(result).toEqual(preview);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("http://api.test/states/06/preview");
  });

  it("asks /history/states/{fips}/preview with the date for a past day", async () => {
    const fetchImpl = fetchReturning(preview);
    await createStatePreviewFetcher("http://api.test", fetchImpl)("06", {
      kind: "historical",
      date: "2021-08-20",
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "http://api.test/history/states/06/preview?date=2021-08-20",
    );
  });

  it("throws ApiError on a non-2xx response or a bad body", async () => {
    await expect(
      createStatePreviewFetcher("http://api.test", fetchReturning({}, 500))("06", LIVE),
    ).rejects.toMatchObject({ status: 500 });
    await expect(
      createStatePreviewFetcher("http://api.test", fetchReturning({ stateId: 6 }))("06", LIVE),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
