import type { BoundingBox } from "./types.ts";

/** Center a 300-square-mile box on a point, accounting for longitude convergence. */
export function createRegionBounds(lat: number, long: number): BoundingBox {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
      !Number.isFinite(long) || long < -180 || long > 180) {
    throw new Error("Invalid regional latitude or longitude.");
  }
  const earthRadiusKm = 6371.0088;
  const areaKm2 = 300 * 1.609344 ** 2;
  const halfLatitude = Math.sqrt(areaKm2) / (2 * earthRadiusKm);
  const latitude = lat * Math.PI / 180;
  if (Math.abs(latitude) + halfLatitude >= Math.PI / 2) {
    throw new Error("The regional search box cannot cross a pole.");
  }
  // Spherical rectangle area = R² * longitude span * (sin(north) - sin(south)).
  const halfLongitude = areaKm2 /
    (4 * earthRadiusKm ** 2 * Math.cos(latitude) * Math.sin(halfLatitude));
  const latitudeOffset = halfLatitude * 180 / Math.PI;
  const longitudeOffset = halfLongitude * 180 / Math.PI;
  const bounds = {
    west: long - longitudeOffset,
    south: lat - latitudeOffset,
    east: long + longitudeOffset,
    north: lat + latitudeOffset,
  };
  if (bounds.west < -180 || bounds.east > 180) {
    throw new Error("The regional search box cannot cross the antimeridian.");
  }
  return bounds;
}

export function createRegionGrid(lat: number, long: number, spacingKm: number) {
  if (!Number.isFinite(spacingKm) || spacingKm <= 0) throw new Error("Invalid grid spacing.");
  const bounds = createRegionBounds(lat, long);
  const count = Math.ceil(Math.sqrt(300) * 1.609344 / spacingKm);
  const cells = Array.from({ length: count * count }, (_, index) => ({
    latitude: bounds.north - (Math.floor(index / count) + 0.5) * (bounds.north - bounds.south) / count,
    longitude: bounds.west + (index % count + 0.5) * (bounds.east - bounds.west) / count,
  }));
  return { bounds, rows: count, columns: count, cells };
}
