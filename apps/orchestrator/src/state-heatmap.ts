import { TtlCache } from "./cache.ts";
import type { Cached } from "./cache.ts";
import type { ServerConfig } from "./config.ts";
import { getFireAttributesIn } from "./fan-out/firms.ts";
import { fetchForecast } from "./fan-out/meteo.ts";
import type { ForecastSample } from "./fan-out/meteo.ts";
import { fetchSource, SourceFetchError } from "./fan-out/source-error.ts";
import type { BoundingBox, SourceFailure } from "./fan-out/types.ts";
import { predictPoints } from "./inference/client.ts";
import type { PredictionMetadata } from "./inference/client.ts";
import { KM_PER_DEGREE, stateOutline } from "./states.ts";
import type { StateOutline } from "./states.ts";
import { detectionCollection } from "./tile-response.ts";

/** The model's native cell size; sampling finer than this adds requests, not detail. */
const NATIVE_SPACING_KM = 10;
/** Degraded results (model or FIRMS unavailable) are retried soon rather than kept. */
const DEGRADED_TTL_MS = 60_000;
const MODEL_HOURS = 24;

export type StateGridPlan = {
  bounds: BoundingBox;
  rows: number;
  columns: number;
  spacingKm: number;
  /** Row-major, north to south, west to east: index into `points`, or -1 for a cell that is not sampled. */
  pointIndex: number[];
  points: Array<{ latitude: number; longitude: number }>;
};

/**
 * A regular latitude/longitude grid over the state's bounding box. Only cells
 * inside the state, plus a one-cell rim so the map can interpolate up to the
 * border, are sampled. The spacing is the finest that keeps the number of
 * sampled points within `maxPoints`, and never finer than the model's cells.
 */
export function planStateGrid(state: StateOutline, maxPoints: number): StateGridPlan {
  const { west, south, east, north } = state.bounds;
  const heightKm = (north - south) * KM_PER_DEGREE;
  const widthKm = (east - west) * KM_PER_DEGREE * Math.cos((south + north) / 2 * Math.PI / 180);
  for (let spacingKm = Math.max(NATIVE_SPACING_KM, Math.sqrt(state.areaKm2 / maxPoints)); ; spacingKm *= 1.08) {
    const rows = Math.max(1, Math.ceil(heightKm / spacingKm));
    const columns = Math.max(1, Math.ceil(widthKm / spacingKm));
    const latitude = (row: number) => north - (row + 0.5) * (north - south) / rows;
    const longitude = (column: number) => west + (column + 0.5) * (east - west) / columns;
    const inside = Array.from({ length: rows * columns }, (_, index) =>
      state.contains(latitude(Math.floor(index / columns)), longitude(index % columns)));
    // A state smaller than one cell may contain no cell centre; sample its whole box.
    const none = !inside.includes(true);
    const points: StateGridPlan["points"] = [];
    const pointIndex = inside.map((_, index) => {
      const row = Math.floor(index / columns), column = index % columns;
      let wanted = none;
      for (let dy = -1; dy <= 1 && !wanted; dy++) {
        for (let dx = -1; dx <= 1 && !wanted; dx++) {
          const r = row + dy, c = column + dx;
          wanted = r >= 0 && r < rows && c >= 0 && c < columns && inside[r * columns + c]!;
        }
      }
      return wanted ? points.push({ latitude: latitude(row), longitude: longitude(column) }) - 1 : -1;
    });
    if (points.length <= maxPoints || rows * columns === 1) {
      return { bounds: state.bounds, rows, columns, spacingKm, pointIndex, points };
    }
  }
}

export type StateHeatmap = {
  stateId: string;
  /** "ready": model scores are present. "observed": detections only. */
  status: "ready" | "observed";
  bounds: [number, number, number, number];
  updatedAt: string | null;
  grid: {
    rows: number;
    columns: number;
    /** Distance between scored points; cells between them are for the client to interpolate. */
    spacingKm: number;
    /** Row-major, north to south, west to east; null where no point was scored. */
    probability: Array<number | null>;
    uncertainty: Array<number | null>;
  } | null;
  detections: ReturnType<typeof detectionCollection>;
  prediction?: PredictionMetadata;
  inference: { status: "ready" | "not_configured" | "unavailable"; message?: string };
  sourceFailures: SourceFailure[];
};

export type StateHeatmapDeps = {
  forecast: (points: StateGridPlan["points"], forecastHours: number) => Promise<ForecastSample[]>;
  fire: typeof getFireAttributesIn;
  predict: typeof predictPoints;
};
const liveDeps: StateHeatmapDeps = { forecast: fetchForecast, fire: getFireAttributesIn, predict: predictPoints };

/**
 * Statewide model scores and FIRMS detections. Weather is required when a
 * model is configured (its failure rejects, like a region's); a FIRMS or
 * inference failure degrades to what is left.
 */
export async function buildStateHeatmap(
  state: StateOutline, config: Pick<ServerConfig, "inference" | "stateHeatmap">, deps: StateHeatmapDeps = liveDeps,
): Promise<StateHeatmap> {
  const { west, south, east, north } = state.bounds;
  const sourceFailures: SourceFailure[] = [];
  const detections = fetchSource("FIRMS", () => deps.fire(state.bounds))
    .then(({ fire }) => fire.detections.filter(d => state.contains(d.location.latitude, d.location.longitude)))
    .catch((error: unknown) => {
      if (!(error instanceof SourceFetchError)) throw error;
      console.error(error.message); // Constructed, credential-free diagnostic.
      sourceFailures.push({
        source: "FIRMS", reason: error.reason, message: error.message,
        ...(error.upstreamStatus === undefined ? {} : { upstreamStatus: error.upstreamStatus }),
      });
      return [];
    });
  const base = async (inference: StateHeatmap["inference"]): Promise<StateHeatmap> => ({
    stateId: state.fips, status: "observed", bounds: [west, south, east, north], updatedAt: null,
    grid: null, detections: detectionCollection(await detections), inference, sourceFailures,
  });
  // Without a model there is nothing to score, so no weather is requested at all.
  if (!config.inference) return base({ status: "not_configured" });

  const plan = planStateGrid(state, config.stateHeatmap.maxPoints);
  const [samples] = await Promise.all([
    fetchSource("Open-Meteo", () => deps.forecast(plan.points, MODEL_HOURS)),
    detections, // Settled here so a weather failure cannot leave it unhandled.
  ]);
  try {
    const scores = await deps.predict(samples.map((sample, index) => ({
      ...plan.points[index]!, elevation_m: sample.elevation_m, hourly: sample.hourly,
    })), config.inference.url, config.inference.timeoutMs);
    const spread = (values: number[]) => plan.pointIndex.map(index => index < 0 ? null : values[index]!);
    return {
      ...await base({ status: "ready" }), status: "ready", updatedAt: scores.updatedAt, prediction: scores.prediction,
      grid: {
        rows: plan.rows, columns: plan.columns, spacingKm: Math.round(plan.spacingKm * 10) / 10,
        probability: spread(scores.probability), uncertainty: spread(scores.uncertainty),
      },
    };
  } catch (error) {
    // Client-constructed, credential-free messages (HTTP status, timeout, contract mismatch).
    console.error(`Statewide inference failed: ${error instanceof Error ? `${error.name}: ${error.message}` : "unknown error"}`);
    return base({ status: "unavailable", message: "Model inference is unavailable. Showing satellite detections only." });
  }
}

export type StateHeatmapService = (fips: string) => Promise<Cached<StateHeatmap> | undefined>;

/** One cached heat map per state, shared by every visitor until it expires. */
export function createStateHeatmapService(
  config: Pick<ServerConfig, "inference" | "stateHeatmap">, deps: StateHeatmapDeps = liveDeps,
): StateHeatmapService {
  const cache = new TtlCache<StateHeatmap>(heatmap =>
    heatmap.sourceFailures.length || heatmap.inference.status === "unavailable"
      ? Math.min(DEGRADED_TTL_MS, config.stateHeatmap.ttlMs) : config.stateHeatmap.ttlMs);
  return async fips => {
    const state = stateOutline(fips);
    return state && cache.get(fips, () => buildStateHeatmap(state, config, deps));
  };
}
