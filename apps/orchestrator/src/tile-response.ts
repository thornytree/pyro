import type { dataBundle } from "./fan-out/types.ts";
import type { InferenceResult } from "./inference.ts";

const EMPTY = { type: "FeatureCollection" as const, features: [] };

/** What the web panel needs to explain the numbers; absent while there is no model output. */
function modelSummary(result: Extract<InferenceResult, { status: "ok" }>) {
  const { occurrence, spread, spreadError } = result;
  return {
    version: occurrence.modelVersion,
    /** Local day the probabilities are for (the day after the observations). */
    predictionDate: occurrence.predictionDate,
    /** Real-world share of cell-days with a detection; `probability` is on this scale. */
    baseRate: occurrence.baseRate,
    fireHistoryThrough: occurrence.fireHistoryThrough,
    spread: spread === null
      ? { status: "unavailable" as const, message: spreadError?.message ?? null }
      : spread.status === "no_confirmed_fire"
        ? { status: "no_confirmed_fire" as const, version: spread.modelVersion }
        : {
          status: "ok" as const, version: spread.modelVersion, fire: spread.fire,
          neighbourCellProbability: spread.neighbourCellProbability,
          meanSpreadKmPerDay: spread.meanSpreadKmPerDay,
        },
  };
}

/**
 * The web GeoJSON envelope. With model output: `status: "ready"`, `cells`,
 * `spread` and `drivers`. Without: `status: "observed"`, the same real
 * detections and bundle, and `inference` says why there are no cells.
 */
export function toTileResponse(bundle: dataBundle, inference: InferenceResult = { status: "not_configured" }) {
  const { latitude, longitude } = bundle.location;
  const { west, south, east, north } = bundle.weather_grid.bounds;
  const ready = inference.status === "ok";
  const spread = ready && inference.spread?.status === "ok" ? inference.spread : null;
  return {
    // Regions are centered on requests, not a fixed 50 km tiling system.
    tileId: `region-${latitude}_${longitude}`,
    status: ready ? "ready" as const : "observed" as const,
    bounds: [west, south, east, north] as [number, number, number, number],
    updatedAt: ready ? inference.occurrence.updatedAt : null,
    cells: ready ? inference.occurrence.cells : EMPTY,
    detections: {
      type: "FeatureCollection" as const,
      features: bundle.fire.detections.map(detection => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [detection.location.longitude, detection.location.latitude],
        },
        properties: {
          source: detection.source.replace(/_NRT$/, ""),
          acquiredAt: detection.observation_time,
          confidence: detection.confidence.kind === "percent" ? detection.confidence.value / 100 : null,
          confidenceCategory: detection.confidence.kind === "category" ? detection.confidence.value : null,
          frpMw: detection.frp_mw,
        },
      })),
    },
    spread: spread?.spread ?? EMPTY,
    drivers: spread?.drivers ?? null,
    model: ready ? modelSummary(inference) : null,
    inference: inference.status === "failed"
      ? { status: "failed" as const, reason: inference.reason, message: inference.message }
      : { status: inference.status },
    bundle,
  };
}
