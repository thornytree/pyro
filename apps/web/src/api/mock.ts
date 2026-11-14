// Generated tiles for UI work before the orchestrator implements GET /tiles.
// Deterministic per tile, so the same click always renders the same data.
// The 0.5 degree tile grid here is a stand-in: the real tile ID scheme and
// projection belong to apps/orchestrator/trigger and are still open.
import type {
  CellCollection,
  DetectionCollection,
  FirmsSource,
  LatLong,
  TileFetcher,
  TileResponse,
} from "./types";

const TILE_DEG = 0.5;
const CELLS_PER_SIDE = 10;
const SOURCES: FirmsSource[] = ["MODIS", "VIIRS_SNPP", "VIIRS_NOAA20", "VIIRS_NOAA21"];

/** mulberry32: small seeded PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

export function buildMockTile({ lat, long }: LatLong, now: Date): TileResponse {
  const row = Math.floor(lat / TILE_DEG);
  const col = Math.floor(long / TILE_DEG);
  const south = row * TILE_DEG;
  const west = col * TILE_DEG;
  const tileId = `mock-${row}_${col}`;
  const random = prng(hash(tileId));
  const step = TILE_DEG / CELLS_PER_SIDE;

  // One hotspot per tile; probability falls off with distance from it.
  const hotX = random() * CELLS_PER_SIDE;
  const hotY = random() * CELLS_PER_SIDE;
  const peak = 0.35 + random() * 0.6;
  const spread = 1.5 + random() * 2.5;

  const cells: CellCollection = { type: "FeatureCollection", features: [] };
  for (let y = 0; y < CELLS_PER_SIDE; y++) {
    for (let x = 0; x < CELLS_PER_SIDE; x++) {
      const d2 = (x + 0.5 - hotX) ** 2 + (y + 0.5 - hotY) ** 2;
      const probability = Math.min(
        1,
        peak * Math.exp(-d2 / (2 * spread ** 2)) + random() * 0.03,
      );
      const w = west + x * step;
      const s = south + y * step;
      cells.features.push({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [w, s],
              [w + step, s],
              [w + step, s + step],
              [w, s + step],
              [w, s],
            ],
          ],
        },
        properties: { probability, uncertainty: 0.1 + random() * 0.5 },
      });
    }
  }

  const detections: DetectionCollection = { type: "FeatureCollection", features: [] };
  const count = Math.round(peak * 8);
  for (let i = 0; i < count; i++) {
    const ageHours = random() * 30;
    detections.features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [
          west + (hotX + (random() - 0.5) * spread) * step,
          south + (hotY + (random() - 0.5) * spread) * step,
        ],
      },
      properties: {
        source: SOURCES[Math.floor(random() * SOURCES.length)] ?? "MODIS",
        acquiredAt: new Date(now.getTime() - ageHours * 3_600_000).toISOString(),
        confidence: random(),
        frpMw: random() * 120,
      },
    });
  }

  return {
    tileId,
    status: "ready",
    bounds: [west, south, west + TILE_DEG, south + TILE_DEG],
    updatedAt: now.toISOString(),
    cells,
    detections,
  };
}

export const mockTileFetcher: TileFetcher = async (point) =>
  buildMockTile(point, new Date());
