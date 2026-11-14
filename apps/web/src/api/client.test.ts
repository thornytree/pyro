import { describe, expect, it, vi } from "vitest";
import { ApiError, createTileFetcher } from "./client";
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
    const result = await createTileFetcher("http://api.test", fetchImpl)(point);

    expect(result).toEqual(tile);
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe("http://api.test/tiles");
    expect(url.searchParams.get("lat")).toBe("39.5");
    expect(url.searchParams.get("long")).toBe("-121.5");
  });

  it("passes the abort signal through", async () => {
    const fetchImpl = fetchReturning(tile);
    const controller = new AbortController();
    await createTileFetcher("http://api.test", fetchImpl)(point, controller.signal);
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it("throws ApiError with the status on a non-2xx response", async () => {
    const fetcher = createTileFetcher("http://api.test", fetchReturning({}, 503));
    await expect(fetcher(point)).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
    });
  });

  it("rejects a body that does not match the tile schema", async () => {
    const fetcher = createTileFetcher(
      "http://api.test",
      fetchReturning({ ...tile, status: "done" }),
    );
    await expect(fetcher(point)).rejects.toBeInstanceOf(ApiError);
  });
});
