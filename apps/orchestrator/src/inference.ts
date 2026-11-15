// Client for apps/inference (FastAPI): POST /predict (model 1, occurrence) and
// POST /spread (model 2). Never throws: a tile request must still return its
// observations when the models are down, slow or reject the bundle.
import type { dataBundle } from "./fan-out/types.ts";

export type InferenceConfig = {
  /** Base URL of the FastAPI service; null leaves the models switched off. */
  url: string | null;
  timeoutMs: number;
};

type Ring = number[][];
type PolygonFeature<P> = {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: Ring[] };
  properties: P;
};
type Collection<P> = { type: "FeatureCollection"; features: PolygonFeature<P>[] };

export type CellProperties = {
  /** Calibrated chance of a FIRMS detection in the cell's 10 km cell over the prediction day. */
  probability: number;
  uncertainty: number;
  /** Uncalibrated 0 to 1 model score; spreads over the whole range, so the map colours by it. */
  riskScore: number;
  detections: number;
};

export type SpreadProperties = {
  horizonHours: number;
  confidence: number;
  origin: [number, number];
  headingDeg: number;
  rateKmh: number;
  headKm: number;
  areaKm2: number;
};

export type WeatherDrivers = {
  observedAt: string;
  temperatureC: number;
  relativeHumidityPct: number;
  windSpeedKmh: number;
  windFromDeg: number;
};

export type OccurrenceOutput = {
  updatedAt: string;
  modelVersion: string;
  predictionDate: string;
  baseRate: number;
  fireHistoryThrough: string | null;
  cells: Collection<CellProperties>;
};

export type SpreadOutput =
  | { status: "no_confirmed_fire"; modelVersion: string }
  | {
    status: "ok";
    modelVersion: string;
    spread: Collection<SpreadProperties>;
    drivers: WeatherDrivers | null;
    fire: { detections: number; cells: number; sensors: number; frpMaxMw: number | null };
    neighbourCellProbability: number;
    meanSpreadKmPerDay: number;
  };

export type InferenceFailure =
  | "unreachable" | "timeout" | "models_missing" | "bundle_rejected" | "bad_response" | "service_error";

export type InferenceResult =
  | { status: "not_configured" }
  | { status: "failed"; reason: InferenceFailure; message: string }
  | {
    status: "ok";
    occurrence: OccurrenceOutput;
    /** Null when only the spread call failed; `spreadError` then says why. */
    spread: SpreadOutput | null;
    spreadError: { reason: InferenceFailure; message: string } | null;
  };

export type RunInference = (bundle: dataBundle) => Promise<InferenceResult>;

class InferenceError extends Error {
  constructor(readonly reason: InferenceFailure, message: string) { super(message); }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isUnit = (value: unknown): value is number => isNumber(value) && value >= 0 && value <= 1;
const isString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

function polygons<P>(value: unknown, validProperties: (properties: Record<string, unknown>) => boolean): Collection<P> | null {
  if (!isRecord(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features)) return null;
  const valid = value.features.every(feature =>
    isRecord(feature) && isRecord(feature.geometry) && feature.geometry.type === "Polygon" &&
    Array.isArray(feature.geometry.coordinates) && isRecord(feature.properties) && validProperties(feature.properties));
  return valid ? value as unknown as Collection<P> : null;
}

function parseOccurrence(body: unknown, expectedCells: number): OccurrenceOutput {
  const cells = isRecord(body)
    ? polygons<CellProperties>(body.cells, p =>
      isUnit(p.probability) && isUnit(p.uncertainty) && isUnit(p.riskScore) && isNumber(p.detections))
    : null;
  if (!isRecord(body) || !cells || cells.features.length !== expectedCells ||
      !isString(body.updatedAt) || !Number.isFinite(Date.parse(body.updatedAt)) ||
      !isString(body.modelVersion) || !isString(body.predictionDate) || !isUnit(body.baseRate) ||
      !(body.fireHistoryThrough === null || isString(body.fireHistoryThrough))) {
    throw new InferenceError("bad_response", "The occurrence model returned an unexpected response.");
  }
  return {
    updatedAt: body.updatedAt, modelVersion: body.modelVersion, predictionDate: body.predictionDate,
    baseRate: body.baseRate, fireHistoryThrough: body.fireHistoryThrough, cells,
  };
}

function parseDrivers(value: unknown): WeatherDrivers | null {
  if (!isRecord(value) || !isString(value.observedAt) || !isNumber(value.temperatureC) ||
      !isNumber(value.relativeHumidityPct) || !isNumber(value.windSpeedKmh) || !isNumber(value.windFromDeg)) return null;
  return {
    observedAt: value.observedAt, temperatureC: value.temperatureC, relativeHumidityPct: value.relativeHumidityPct,
    windSpeedKmh: value.windSpeedKmh, windFromDeg: value.windFromDeg,
  };
}

function parseSpread(body: unknown): SpreadOutput {
  const bad = () => new InferenceError("bad_response", "The spread model returned an unexpected response.");
  if (!isRecord(body) || !isString(body.modelVersion)) throw bad();
  if (body.status === "no_confirmed_fire") return { status: "no_confirmed_fire", modelVersion: body.modelVersion };
  const spread = polygons<SpreadProperties>(body.spread, p =>
    isNumber(p.horizonHours) && isUnit(p.confidence) && isNumber(p.headingDeg) && isNumber(p.rateKmh) &&
    isNumber(p.headKm) && isNumber(p.areaKm2) &&
    Array.isArray(p.origin) && p.origin.length === 2 && p.origin.every(isNumber));
  const fire = body.fire;
  if (body.status !== "ok" || !spread || !isRecord(fire) || !isNumber(fire.detections) || !isNumber(fire.cells) ||
      !isNumber(fire.sensors) || !(fire.frpMaxMw === null || isNumber(fire.frpMaxMw)) ||
      !isUnit(body.neighbourCellProbability) || !isNumber(body.meanSpreadKmPerDay)) throw bad();
  return {
    status: "ok", modelVersion: body.modelVersion, spread, drivers: parseDrivers(body.drivers),
    fire: { detections: fire.detections, cells: fire.cells, sensors: fire.sensors, frpMaxMw: fire.frpMaxMw },
    neighbourCellProbability: body.neighbourCellProbability, meanSpreadKmPerDay: body.meanSpreadKmPerDay,
  };
}

/** FastAPI errors are `{ detail }`; keep a short, single-line copy for the log and the panel. */
async function errorDetail(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.detail === "string") return `: ${body.detail.replace(/\s+/g, " ").slice(0, 300)}`;
  } catch { /* Not JSON: the status is all there is. */ }
  return "";
}

async function post(config: { url: string; timeoutMs: number }, path: string, payload: string, fetchImpl: typeof fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(`${config.url}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: payload,
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new InferenceError("timeout", `Inference ${path} did not answer within ${config.timeoutMs} ms.`);
    }
    throw new InferenceError("unreachable", `Inference service is not reachable at ${config.url}.`);
  }
  if (!response.ok) {
    const reason: InferenceFailure = response.status === 503 ? "models_missing"
      : response.status === 422 ? "bundle_rejected" : "service_error";
    throw new InferenceError(reason, `Inference ${path} returned HTTP ${response.status}${await errorDetail(response)}`);
  }
  try {
    return await response.json();
  } catch {
    throw new InferenceError("bad_response", `Inference ${path} did not return JSON.`);
  }
}

const failure = (error: unknown) => error instanceof InferenceError
  ? { reason: error.reason, message: error.message }
  : { reason: "service_error" as const, message: "Inference failed unexpectedly." };

export function createInference(config: InferenceConfig, fetchImpl: typeof fetch = fetch): RunInference {
  const { url, timeoutMs } = config;
  if (url === null) return async () => ({ status: "not_configured" });
  return async bundle => {
    // Neither model reads Daymet (training-only, a year behind), and it is the bulk of the bundle.
    const payload = JSON.stringify({ ...bundle, historical_weather: undefined });
    const expectedCells = bundle.weather_grid.rows * bundle.weather_grid.columns;
    const [occurrence, spread] = await Promise.allSettled([
      post({ url, timeoutMs }, "/predict", payload, fetchImpl).then(body => parseOccurrence(body, expectedCells)),
      post({ url, timeoutMs }, "/spread", payload, fetchImpl).then(parseSpread),
    ]);
    if (occurrence.status === "rejected") return { status: "failed", ...failure(occurrence.reason) };
    return {
      status: "ok", occurrence: occurrence.value,
      spread: spread.status === "fulfilled" ? spread.value : null,
      spreadError: spread.status === "rejected" ? failure(spread.reason) : null,
    };
  };
}

export type InferenceHealth = "not_connected" | "connected" | "models_missing" | "unreachable";

/** For GET /health: is the service up and are both artifacts loaded? */
export async function inferenceHealth(config: InferenceConfig, fetchImpl: typeof fetch = fetch): Promise<InferenceHealth> {
  if (config.url === null) return "not_connected";
  try {
    const response = await fetchImpl(`${config.url}/health`, { signal: AbortSignal.timeout(Math.min(config.timeoutMs, 3000)) });
    const body: unknown = await response.json();
    return response.ok && isRecord(body) && body.status === "ok" ? "connected" : "models_missing";
  } catch {
    return "unreachable";
  }
}
