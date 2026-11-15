import type { dataBundle, FireDetection } from "./fan-out/types.ts";

/** FIRMS detections as GeoJSON points; MODIS percent becomes 0-1, VIIRS keeps its category. */
export function detectionCollection(detections: FireDetection[]) {
  return {
    type: "FeatureCollection" as const,
    features: detections.map(detection => ({
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
  };
}

/** Match the web GeoJSON envelope while keeping observations distinct from model output. */
export function toTileResponse(bundle: dataBundle) {
  const { latitude, longitude } = bundle.location;
  const { west, south, east, north } = bundle.weather_grid.bounds;
  return {
    // Regions are centered on requests, not a fixed 50 km tiling system.
    tileId: `region-${latitude}_${longitude}`,
    status: "observed" as const,
    bounds: [west, south, east, north] as [number, number, number, number],
    updatedAt: null, // Reserved for the timestamp of actual model output.
    cells: { type: "FeatureCollection" as const, features: [] },
    detections: detectionCollection(bundle.fire?.detections ?? []),
    bundle,
  };
}
