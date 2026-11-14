// Coarse client-side pre-check so obviously out-of-area clicks get instant
// feedback. It is a bounding box (it includes parts of Canada, Mexico and
// ocean); the orchestrator's validation is authoritative.
export const CONUS_BOUNDS = {
  west: -125.0,
  south: 24.4,
  east: -66.9,
  north: 49.4,
} as const;

export function isInConusBounds(lat: number, long: number): boolean {
  return (
    lat >= CONUS_BOUNDS.south &&
    lat <= CONUS_BOUNDS.north &&
    long >= CONUS_BOUNDS.west &&
    long <= CONUS_BOUNDS.east
  );
}
