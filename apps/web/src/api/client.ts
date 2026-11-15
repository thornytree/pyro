import type {
  ActiveFire,
  ActiveFireFetcher,
  LatLong,
  StatePreview,
  StatePreviewFetcher,
  TileFetcher,
  TileResponse,
} from "./types";
import { isIsoDate } from "../lib/mode";
import type { MapMode } from "../lib/mode";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly source?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function isTileResponse(value: unknown, point: LatLong): value is TileResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.tileId === "string" &&
    (v.status === "ready" || v.status === "queued" || v.status === "observed") &&
    Array.isArray(v.bounds) &&
    v.bounds.length === 4 &&
    v.bounds.every((n) => typeof n === "number" && Number.isFinite(n)) &&
    validBounds(v.bounds as number[], point) &&
    (v.updatedAt === null || typeof v.updatedAt === "string") &&
    (v.status !== "observed" || validObservedBundle(v.bundle, point, v.bounds as number[])) &&
    isFeatureCollection(v.cells) &&
    isFeatureCollection(v.detections) &&
    (v.spread === undefined || isFeatureCollection(v.spread)) &&
    (v.perimeters === undefined || isFeatureCollection(v.perimeters)) &&
    (v.drivers === undefined || v.drivers === null || typeof v.drivers === "object") &&
    (v.model === undefined || v.model === null || validModel(v.model)) &&
    (v.inference === undefined || typeof record(v.inference)?.status === "string")
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** The panel reads these directly, so a malformed summary must not reach it. */
function validModel(value: unknown): boolean {
  const model = record(value);
  const spread = record(model?.spread);
  return !!model && !!spread && typeof model.version === "string" &&
    typeof model.predictionDate === "string" && isIsoDate(model.predictionDate) &&
    typeof model.baseRate === "number" && Number.isFinite(model.baseRate) &&
    (spread.status === "no_confirmed_fire" || spread.status === "unavailable" ||
      (spread.status === "ok" && typeof spread.meanSpreadKmPerDay === "number" &&
        typeof record(spread.fire)?.detections === "number"));
}

function validBounds(bounds: number[], point: LatLong): boolean {
  const [west, south, east, north] = bounds as [number, number, number, number];
  return west >= -180 && east <= 180 && south >= -90 && north <= 90 && west < east && south < north &&
    point.long >= west && point.long <= east && point.lat >= south && point.lat <= north;
}

/** Check selection and geographic alignment; scientific feature validation stays server-side. */
function validObservedBundle(value: unknown, point: LatLong, bounds: number[]): boolean {
  const bundle = record(value);
  if (!bundle) return false;
  const location = record(bundle.location);
  const weather = record(bundle.weather);
  const weatherGrid = record(bundle.weather_grid);
  const terrain = record(bundle.terrain);
  const vegetation = record(bundle.vegetation);
  const history = record(bundle.historical_weather);
  const fire = record(bundle.fire);
  if (!location || !weather || !weatherGrid || !terrain || !vegetation || !history || !fire) return false;
  if (typeof location.latitude !== "number" || typeof location.longitude !== "number" ||
      Math.abs(location.latitude - point.lat) > 1e-8 || Math.abs(location.longitude - point.long) > 1e-8) return false;
  if (!["temperature", "humidity", "wind_speed_kph", "wind_direction"].every(key =>
    typeof weather[key] === "number" && Number.isFinite(weather[key]))) return false;
  if (!["elevation_m", "slope_degrees", "aspect_degrees"].every(key =>
    terrain[key] === null || (typeof terrain[key] === "number" && Number.isFinite(terrain[key])))) return false;
  if (typeof bundle.observation_time !== "string" || !Number.isFinite(Date.parse(bundle.observation_time)) ||
      typeof history.start_date !== "string" || !isIsoDate(history.start_date) ||
      typeof history.end_date !== "string" || !isIsoDate(history.end_date) ||
      typeof vegetation.version !== "string" || !Array.isArray(fire.detections)) return false;
  const matchesBounds = (value: unknown) => {
    const object = record(value);
    return !!object && ["west", "south", "east", "north"].every((key, i) =>
      typeof object[key] === "number" && Math.abs(object[key] - bounds[i]!) < 1e-8);
  };
  const grids = [weatherGrid, record(terrain.grid), record(vegetation.grid), record(history.grid)];
  if (!matchesBounds(weatherGrid.bounds) || !matchesBounds(history.bounds) ||
      !matchesBounds(record(terrain.grid)?.bounds) || !matchesBounds(record(vegetation.grid)?.bounds)) return false;
  return grids.every(grid => grid !== null &&
    Number.isInteger(grid.rows) && Number(grid.rows) > 0 &&
    Number.isInteger(grid.columns) && Number(grid.columns) > 0 &&
    grid.rows === weatherGrid.rows && grid.columns === weatherGrid.columns &&
    Array.isArray(grid.cells) && grid.cells.length === Number(grid.rows) * Number(grid.columns) &&
    (grid.bounds === undefined || matchesBounds(grid.bounds)));
}

async function responseError(response: Response): Promise<ApiError> {
  try {
    const body = record(await response.json());
    const error = record(body?.error);
    if (error && typeof error.message === "string") {
      return new ApiError(error.message.slice(0, 500), response.status,
        typeof error.code === "string" ? error.code : undefined,
        typeof error.source === "string" ? error.source : undefined);
    }
  } catch { /* Non-JSON proxy errors use the HTTP status fallback. */ }
  return new ApiError(`Orchestrator returned ${response.status}`, response.status);
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
      throw await responseError(response);
    }
    const body: unknown = await response.json();
    if (!isTileResponse(body, { lat, long })) {
      throw new ApiError("Orchestrator response does not match the selected region or tile schema");
    }
    return body;
  };
}

function isStatePreview(value: unknown, stateId: string): value is StatePreview {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.stateId === stateId &&
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
      throw await responseError(response);
    }
    const body: unknown = await response.json();
    if (!isStatePreview(body, stateId)) {
      throw new ApiError("Orchestrator response does not match the state preview schema");
    }
    return body;
  };
}

function isActiveFire(value: unknown): value is ActiveFire {
  const fire = record(value);
  return !!fire && typeof fire.newestAt === "string" &&
    ["latitude", "longitude", "detections", "sensors"].every(key =>
      typeof fire[key] === "number" && Number.isFinite(fire[key])) &&
    (fire.frpMaxMw === null || typeof fire.frpMaxMw === "number");
}

/** Confirmed fires across CONUS: GET {baseUrl}/fires. */
export function createActiveFireFetcher(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): ActiveFireFetcher {
  return async (signal?: AbortSignal) => {
    const response = await fetchImpl(`${baseUrl}/fires`, { signal });
    if (!response.ok) {
      throw await responseError(response);
    }
    const fires = record(await response.json())?.fires;
    if (!Array.isArray(fires) || !fires.every(isActiveFire)) {
      throw new ApiError("Orchestrator response does not match the active fire schema");
    }
    return fires;
  };
}
