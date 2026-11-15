import { tileIdAt } from "./grid.ts";
import type { Ingestion } from "./scheduler.ts";
import type TileBundle from "./types.ts";

// User trigger (work item 1). Under decision 2 a request never fetches external
// data itself: it snaps the point to its 50 km tile, marks the tile active and
// returns whatever the scheduler has cached ("queued" until weather arrives).
export function requestTileAt(ingestion: Ingestion, lat: number, long: number): TileBundle {
  const tileId = tileIdAt(lat, long);
  if (!tileId) throw new Error("Point is outside the supported area (CONUS).");
  return ingestion.requestTile(tileId);
}
