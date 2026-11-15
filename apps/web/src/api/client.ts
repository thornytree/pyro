import type {
  LatLong,
  StateHeatmap,
  StateHeatmapFetcher,
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
    ((v.status !== "observed" && v.bundle === undefined) || validObservedBundle(v.bundle, point, v.bounds as number[])) &&
    isFeatureCollection(v.cells) &&
    isFeatureCollection(v.detections) &&
    (v.spread === undefined || isFeatureCollection(v.spread)) &&
    (v.perimeters === undefined || isFeatureCollection(v.perimeters)) &&
    (v.drivers === undefined || v.drivers === null || typeof v.drivers === "object")
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
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
  // Weather is required. The other sources are null when their provider failed.
  const optional = (value: unknown) => value === null ? null : record(value) ?? undefined;
  const terrain = optional(bundle.terrain);
  const vegetation = optional(bundle.vegetation);
  const history = optional(bundle.historical_weather);
  const fire = optional(bundle.fire);
  if (!location || !weather || !weatherGrid || terrain === undefined || vegetation === undefined ||
      history === undefined || fire === undefined || !Array.isArray(bundle.source_failures)) return false;
  if (typeof location.latitude !== "number" || typeof location.longitude !== "number" ||
      Math.abs(location.latitude - point.lat) > 1e-8 || Math.abs(location.longitude - point.long) > 1e-8) return false;
  if (!["temperature", "humidity", "wind_speed_kph", "wind_direction"].every(key =>
    typeof weather[key] === "number" && Number.isFinite(weather[key]))) return false;
  if (terrain && !["elevation_m", "slope_degrees", "aspect_degrees"].every(key =>
    terrain[key] === null || (typeof terrain[key] === "number" && Number.isFinite(terrain[key])))) return false;
  if (typeof bundle.observation_time !== "string" || !Number.isFinite(Date.parse(bundle.observation_time)) ||
      (history && (typeof history.start_date !== "string" || !isIsoDate(history.start_date) ||
        typeof history.end_date !== "string" || !isIsoDate(history.end_date))) ||
      (vegetation && typeof vegetation.version !== "string") || (fire && !Array.isArray(fire.detections))) return false;
  const matchesBounds = (value: unknown) => {
    const object = record(value);
    return !!object && ["west", "south", "east", "north"].every((key, i) =>
      typeof object[key] === "number" && Math.abs(object[key] - bounds[i]!) < 1e-8);
  };
  const grids = [weatherGrid, ...[terrain, vegetation, history].filter(source => source !== null).map(source => record(source.grid))];
  if (!matchesBounds(weatherGrid.bounds) || (history && !matchesBounds(history.bounds)) ||
      (terrain && !matchesBounds(record(terrain.grid)?.bounds)) ||
      (vegetation && !matchesBounds(record(vegetation.grid)?.bounds))) return false;
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

/** Historical tiles live under /history and are read-only on the orchestrator. */
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

const scores = (value: unknown, length: number) =>
  Array.isArray(value) && value.length === length &&
  value.every((v) => v === null || (typeof v === "number" && v >= 0 && v <= 1));

function isStateHeatmap(value: unknown, stateId: string): value is StateHeatmap {
  const v = record(value);
  if (!v || v.stateId !== stateId || (v.status !== "ready" && v.status !== "observed")) return false;
  const bounds = v.bounds;
  if (!Array.isArray(bounds) || bounds.length !== 4 ||
      !bounds.every((n) => typeof n === "number" && Number.isFinite(n)) ||
      bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) return false;
  if ((v.updatedAt !== null && typeof v.updatedAt !== "string") || !isFeatureCollection(v.detections)) return false;
  if (v.grid === null) return v.status === "observed";
  const grid = record(v.grid);
  return !!grid && Number.isInteger(grid.rows) && Number.isInteger(grid.columns) &&
    Number(grid.rows) > 0 && Number(grid.columns) > 0 && typeof grid.spacingKm === "number" &&
    scores(grid.probability, Number(grid.rows) * Number(grid.columns)) &&
    scores(grid.uncertainty, Number(grid.rows) * Number(grid.columns));
}

/**
 * Statewide heat map against apps/orchestrator: GET {baseUrl}/states/{fips}/heatmap.
 * The server caches it per state and lets the browser reuse it for a few minutes.
 * Historical mode has no statewide archive, so it resolves to null without a request.
 */
export function createStateHeatmapFetcher(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): StateHeatmapFetcher {
  return async (stateId: string, mode: MapMode, signal?: AbortSignal) => {
    if (mode.kind === "historical") return null;
    const response = await fetchImpl(
      `${baseUrl}/states/${encodeURIComponent(stateId)}/heatmap`,
      { signal },
    );
    if (!response.ok) {
      throw await responseError(response);
    }
    const body: unknown = await response.json();
    if (!isStateHeatmap(body, stateId)) {
      throw new ApiError("Orchestrator response does not match the state heat map schema");
    }
    return body;
  };
}
