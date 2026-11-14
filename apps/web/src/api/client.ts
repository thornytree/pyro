import type { LatLong, TileFetcher, TileResponse } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function isTileResponse(value: unknown): value is TileResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.tileId === "string" &&
    (v.status === "ready" || v.status === "queued") &&
    Array.isArray(v.bounds) &&
    v.bounds.length === 4 &&
    v.bounds.every((n) => typeof n === "number") &&
    isFeatureCollection(v.cells) &&
    isFeatureCollection(v.detections)
  );
}

function isFeatureCollection(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.type === "FeatureCollection" && Array.isArray(v.features);
}

/** Tile lookup against apps/orchestrator: GET {baseUrl}/tiles?lat=&long= */
export function createTileFetcher(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): TileFetcher {
  return async ({ lat, long }: LatLong, signal?: AbortSignal) => {
    const query = new URLSearchParams({ lat: String(lat), long: String(long) });
    const response = await fetchImpl(`${baseUrl}/tiles?${query}`, { signal });
    if (!response.ok) {
      throw new ApiError(
        `Orchestrator returned ${response.status}`,
        response.status,
      );
    }
    const body: unknown = await response.json();
    if (!isTileResponse(body)) {
      throw new ApiError("Orchestrator response does not match the tile schema");
    }
    return body;
  };
}
