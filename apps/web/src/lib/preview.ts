import type { StatePreview } from "../api/types";

export interface PreviewSummary {
  tileCount: number;
  /** Tiles with model output. */
  readyCount: number;
  peak: number | null;
  /** Tiles whose peak probability is at least `threshold`. */
  hotCount: number;
  /** Centre of the tile with the highest peak, to jump to it. */
  hottest: { tileId: string; lat: number; long: number } | null;
}

export function summarizePreview(preview: StatePreview, threshold = 0.5): PreviewSummary {
  let readyCount = 0;
  let hotCount = 0;
  let peak: number | null = null;
  let hottest: PreviewSummary["hottest"] = null;

  for (const { geometry, properties } of preview.tiles.features) {
    const p = properties.peakProbability;
    if (typeof p !== "number") continue;
    readyCount++;
    if (p >= threshold) hotCount++;
    if (peak === null || p > peak) {
      peak = p;
      const ring = geometry.coordinates[0] ?? [];
      const longs = ring.map((c) => c[0] ?? 0);
      const lats = ring.map((c) => c[1] ?? 0);
      hottest = {
        tileId: properties.tileId,
        long: (Math.min(...longs) + Math.max(...longs)) / 2,
        lat: (Math.min(...lats) + Math.max(...lats)) / 2,
      };
    }
  }
  return { tileCount: preview.tiles.features.length, readyCount, peak, hotCount, hottest };
}
