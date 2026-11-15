import type { dataBundle } from "../fan-out/types.ts";

export type PredictionMetadata = {
  modelVersion: string;
  target: "any_firms_detection_in_10km_cell_day";
  scoreKind: "sample_relative";
  horizonHours: 24;
  nativeResolutionKm: 10;
  nativeCellCount: number;
  uncertaintyKind: "twice_bootstrap_ensemble_standard_deviation";
  windowStart: string;
  windowEnd: string;
  experimental: true;
};
export type InferenceResult = {
  updatedAt: string;
  prediction: PredictionMetadata;
  cells: {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      geometry: { type: "Polygon"; coordinates: number[][][] };
      properties: { probability: number; uncertainty: number; nativeCellId: string };
    }>;
  };
};

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
const unitValue = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const timestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));

/** Reject mismatched geography, missing cells and invalid scores before marking a tile ready. */
export function validatePrediction(value: unknown, bundle: dataBundle): InferenceResult {
  const result = object(value);
  const cells = object(result?.cells);
  const metadata = object(result?.prediction);
  const g = bundle.weather_grid;
  if (!result || !timestamp(result.updatedAt) || !cells || cells.type !== "FeatureCollection" ||
      !Array.isArray(cells.features) || cells.features.length !== g.rows * g.columns || !metadata ||
      typeof metadata.modelVersion !== "string" || metadata.target !== "any_firms_detection_in_10km_cell_day" ||
      metadata.scoreKind !== "sample_relative" || metadata.horizonHours !== 24 || metadata.nativeResolutionKm !== 10 ||
      metadata.experimental !== true || metadata.uncertaintyKind !== "twice_bootstrap_ensemble_standard_deviation" ||
      !Number.isInteger(metadata.nativeCellCount) || Number(metadata.nativeCellCount) < 1 ||
      !timestamp(metadata.windowStart) || !timestamp(metadata.windowEnd) ||
      Date.parse(String(metadata.windowEnd)) - Date.parse(String(metadata.windowStart)) !== 86400000) {
    throw new Error("Inference response does not match the model contract.");
  }
  const expectedStart = g.samples[0]?.hourly[0]?.time;
  if (!expectedStart || Date.parse(String(metadata.windowStart)) !== Date.parse(expectedStart)) {
    throw new Error("Inference returned a different forecast window.");
  }
  const dx = (g.bounds.east - g.bounds.west) / g.columns;
  const dy = (g.bounds.north - g.bounds.south) / g.rows;
  cells.features.forEach((raw, index) => {
    const feature = object(raw);
    const props = object(feature?.properties);
    const geometry = object(feature?.geometry);
    const coordinates = geometry?.coordinates;
    const ring = Array.isArray(coordinates) && coordinates.length === 1 ? coordinates[0] : null;
    const west = g.bounds.west + index % g.columns * dx;
    const north = g.bounds.north - Math.floor(index / g.columns) * dy;
    const expected = [[west, north - dy], [west + dx, north - dy], [west + dx, north], [west, north], [west, north - dy]];
    if (feature?.type !== "Feature" || geometry?.type !== "Polygon" || !props ||
        !unitValue(props.probability) || !unitValue(props.uncertainty) || typeof props.nativeCellId !== "string" ||
        !Array.isArray(ring) || ring.length !== 5 || ring.some((point, vertex) => !Array.isArray(point) || point.length !== 2 ||
          point.some((coordinate, axis) => typeof coordinate !== "number" || !Number.isFinite(coordinate) ||
            Math.abs(coordinate - expected[vertex]![axis]!) > 1e-6))) {
      throw new Error("Inference returned invalid or geographically misaligned cells.");
    }
  });
  return value as InferenceResult;
}

export async function predictBundle(bundle: dataBundle, baseUrl: string, timeoutMs: number): Promise<InferenceResult> {
  const response = await fetch(`${baseUrl}/predict`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bundle), signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Inference returned HTTP ${response.status}.`);
  return validatePrediction(await response.json(), bundle);
}
