// The region a click loads: the orchestrator's 300-square-mile box. Port of
// createRegionBounds in apps/orchestrator/src/fan-out/region.ts; keep the two
// in step. Live clicks snap to a fixed grid of these boxes, so the box drawn
// under the cursor is exactly the tile a click loads.
import type { LatLong } from "../api/types";
import type { Bounds } from "./geo";
import { CONUS_BOUNDS, isInConusBounds } from "./conus";

const EARTH_RADIUS_KM = 6371.0088;
const AREA_KM2 = 300 * 1.609344 ** 2;
const HALF_LAT_RAD = Math.sqrt(AREA_KM2) / (2 * EARTH_RADIUS_KM);
const DEG = 180 / Math.PI;

/** Half the box's width in degrees of longitude at `lat`. */
function halfLongDeg(lat: number): number {
  return (
    (AREA_KM2 / (4 * EARTH_RADIUS_KM ** 2 * Math.cos(lat / DEG) * Math.sin(HALF_LAT_RAD))) * DEG
  );
}

/** [west, south, east, north] of the region centred on a point. */
export function regionBounds({ lat, long }: LatLong): Bounds {
  const dLat = HALF_LAT_RAD * DEG;
  const dLong = halfLongDeg(lat);
  return [long - dLong, lat - dLat, long + dLong, lat + dLat];
}

/**
 * Centre of the grid tile holding a point. Rows are one box tall from the
 * southern CONUS bound; each row is cut into boxes from the western bound.
 * A point whose tile centre falls outside the supported area is returned as is.
 */
export function snapToRegion(point: LatLong): LatLong {
  const latStep = 2 * HALF_LAT_RAD * DEG;
  const lat = CONUS_BOUNDS.south + (Math.floor((point.lat - CONUS_BOUNDS.south) / latStep) + 0.5) * latStep;
  const longStep = 2 * halfLongDeg(lat);
  const long = CONUS_BOUNDS.west + (Math.floor((point.long - CONUS_BOUNDS.west) / longStep) + 0.5) * longStep;
  return isInConusBounds(lat, long) ? { lat, long } : point;
}
