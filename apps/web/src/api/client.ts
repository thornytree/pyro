import type {
  LatLong,
  StatePreview,
  StatePreviewFetcher,
  TileFetcher,
  TileResponse,
} from "./types";
import type { MapMode } from "../lib/mode";

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
    (v.status === "ready" || v.status === "queued" || v.status === "observed") &&
    Array.isArray(v.bounds) &&
    v.bounds.length === 4 &&
    v.bounds.every((n) => typeof n === "number") &&
    isFeatureCollection(v.cells) &&
    isFeatureCollection(v.detections) &&
    (v.spread === undefined || isFeatureCollection(v.spread)) &&
    (v.perimeters === undefined || isFeatureCollection(v.perimeters)) &&
    (v.drivers === undefined || v.drivers === null || typeof v.drivers === "object")
  );
}

function isFeatureCollection(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.type === "FeatureCollection" && Array.isArray(v.features);
}

/** Historical routes live under /history and are read-only on the orchestrator. */
const routePrefix = (mode: MapMode) => (mode.kind === "historical" ? "/history" : "");
const dateQuery = (mode: MapMode): Record<string, string> =>
  mode.kind === "historical" ? { date: mode.date } : {};

/**
 * Tile lookup against apps/orchestrator.
 * Live: GET {baseUrl}/tiles?lat=&long=
 * Historical: GET {baseUrl}/history/tiles?lat=&long=&date=YYYY-MM-DD
 */
export function createTileFetcher(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): TileFetcher {
  return async ({ lat, long }: LatLong, mode: MapMode, signal?: AbortSignal) => {
    const query = new URLSearchParams({ lat: String(lat), long: String(long), ...dateQuery(mode) });
    const response = await fetchImpl(`${baseUrl}${routePrefix(mode)}/tiles?${query}`, { signal });
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

function isStatePreview(value: unknown): value is StatePreview {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.stateId === "string" &&
    (v.updatedAt === null || typeof v.updatedAt === "string") &&
    isFeatureCollection(v.tiles)
  );
}

/**
 * State overview against apps/orchestrator.
 * Live: GET {baseUrl}/states/{fips}/preview
 * Historical: GET {baseUrl}/history/states/{fips}/preview?date=YYYY-MM-DD
 */
export function createStatePreviewFetcher(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): StatePreviewFetcher {
  return async (stateId: string, mode: MapMode, signal?: AbortSignal) => {
    const query = new URLSearchParams(dateQuery(mode)).toString();
    const response = await fetchImpl(
      `${baseUrl}${routePrefix(mode)}/states/${encodeURIComponent(stateId)}/preview${query ? `?${query}` : ""}`,
      { signal },
    );
    if (!response.ok) {
      throw new ApiError(
        `Orchestrator returned ${response.status}`,
        response.status,
      );
    }
    const body: unknown = await response.json();
    if (!isStatePreview(body)) {
      throw new ApiError("Orchestrator response does not match the state preview schema");
    }
    return body;
  };
}
