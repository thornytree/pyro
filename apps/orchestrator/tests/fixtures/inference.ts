// Responses shaped like apps/inference POST /predict and POST /spread.
import type { dataBundle } from "../../src/fan-out/types.ts";

const square = (west: number, south: number, east: number, north: number) =>
  [[[west, south], [east, south], [east, north], [west, north], [west, south]]];

export function occurrenceBody(bundle: dataBundle, properties: Partial<Record<"probability" | "uncertainty" | "riskScore" | "detections", number>> = {}) {
  const { bounds, rows, columns } = bundle.weather_grid;
  const dy = (bounds.north - bounds.south) / rows;
  const dx = (bounds.east - bounds.west) / columns;
  return {
    updatedAt: "2026-11-15T09:00:00+00:00",
    modelVersion: "occurrence-test",
    predictionDate: "2026-11-15",
    baseRate: 0.01417,
    fireHistoryThrough: "2026-11-14",
    cells: {
      type: "FeatureCollection" as const,
      features: Array.from({ length: rows * columns }, (_, i) => {
        const row = Math.floor(i / columns), column = i % columns;
        const west = bounds.west + column * dx, north = bounds.north - row * dy;
        return {
          type: "Feature" as const,
          geometry: { type: "Polygon" as const, coordinates: square(west, north - dy, west + dx, north) },
          properties: { probability: 0.0312, uncertainty: 0.05, riskScore: 0.7, detections: 0, ...properties },
        };
      }),
    },
  };
}

export function spreadBody(bundle: dataBundle) {
  const { latitude, longitude } = bundle.location;
  return {
    updatedAt: "2026-11-15T09:00:00+00:00",
    modelVersion: "spread-test",
    status: "ok" as const,
    fire: { detections: 2, cells: 1, sensors: 2, frpMaxMw: 12 },
    neighbourCellProbability: 0.008,
    meanSpreadKmPerDay: 0.16,
    spread: {
      type: "FeatureCollection" as const,
      features: [6, 12, 24].map(horizonHours => ({
        type: "Feature" as const,
        geometry: {
          type: "Polygon" as const,
          coordinates: square(longitude - 0.01, latitude - 0.01, longitude + 0.01 * horizonHours / 6, latitude + 0.01),
        },
        properties: {
          horizonHours, confidence: 0.5, origin: [longitude, latitude], headingDeg: 90,
          rateKmh: 0.2, headKm: 0.2 * horizonHours, areaKm2: horizonHours / 2,
        },
      })),
    },
    cells: { type: "FeatureCollection" as const, features: [] },
    drivers: { observedAt: bundle.observation_time, temperatureC: 20, relativeHumidityPct: 50, windSpeedKmh: 10, windFromDeg: 270 },
  };
}
