// Wind-driven elliptical fire spread, as used by FARSITE / Prometheus-style
// models. On a real backend the spread polygons come from the inference API;
// the web app only uses this to generate mock spread and to draw the heading
// arrow. Distances are km, angles are degrees clockwise from north.
import type { FeatureCollection, LineString, Polygon, Position } from "geojson";

/** Cells at or above this probability count as extreme risk and get a spread prediction. */
export const EXTREME_PROBABILITY = 0.8;

/** Forecast horizons drawn as spread outlines, in hours. */
export const SPREAD_HORIZONS = [6, 12, 24] as const;

const KM_PER_DEG_LAT = 111.32;
const KM_PER_MILE = 1.609344;

export const kmToMiles = (km: number) => km / KM_PER_MILE;

/** Spread heading: fire runs downwind, opposite the direction the wind comes from. */
export const headingFromWind = (windFromDeg: number) => (((windFromDeg + 180) % 360) + 360) % 360;

/**
 * Midflame wind as a share of the 10 m wind that weather APIs report. 0.4 is
 * a common wind adjustment factor for partially sheltered fuels; the real
 * value depends on canopy cover (LANDFIRE) and belongs in the model.
 */
export const WIND_ADJUSTMENT = 0.4;

/**
 * Length-to-breadth ratio of the spread ellipse from midflame wind speed
 * (Anderson 1983). Calm air gives a circle (1); stronger wind a longer,
 * narrower ellipse. Capped at 8, past which the empirical fit is unsupported.
 * Pass midflame wind: 10 m wind times WIND_ADJUSTMENT.
 */
export function lengthToBreadth(midflameWindKmh: number): number {
  const mph = Math.max(0, midflameWindKmh) / KM_PER_MILE;
  const lb = 0.936 * Math.exp(0.2566 * mph) + 0.461 * Math.exp(-0.1548 * mph) - 0.397;
  return Math.min(8, Math.max(1, lb));
}

/** Moves `km` from `origin` along `headingDeg`, on a local flat-earth approximation (fine below ~50 km). */
export function offset([long = 0, lat = 0]: Position, headingDeg: number, km: number): Position {
  const rad = (headingDeg * Math.PI) / 180;
  const north = km * Math.cos(rad);
  const east = km * Math.sin(rad);
  return [
    long + east / (KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)),
    lat + north / KM_PER_DEG_LAT,
  ];
}

export interface EllipseInput {
  /** Ignition point, [long, lat]. */
  origin: Position;
  headingDeg: number;
  /** Distance the head fire travels. */
  headKm: number;
  /** Length-to-breadth ratio, >= 1. */
  lb: number;
  /** Ring vertices; more is smoother. */
  segments?: number;
}

/**
 * Closed ring of the spread ellipse. The ignition point sits at the rear
 * focus, so the head runs `headKm` forward and the backing fire a shorter
 * distance behind, set by the head-to-back ratio implied by `lb`.
 */
export function spreadEllipse({ origin, headingDeg, headKm, lb, segments = 48 }: EllipseInput): Position[] {
  const ratio = Math.max(1, lb);
  const root = Math.sqrt(ratio * ratio - 1);
  const headToBack = (ratio + root) / (ratio - root);
  const backKm = headKm / headToBack;
  const a = (headKm + backKm) / 2;
  const b = a / ratio;
  const centre = offset(origin, headingDeg, a - backKm);
  const rad = (headingDeg * Math.PI) / 180;

  const ring: Position[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (2 * Math.PI * i) / segments;
    // Ellipse in a frame where +along is the heading, then rotated to north/east.
    const along = a * Math.cos(t);
    const across = b * Math.sin(t);
    const north = along * Math.cos(rad) - across * Math.sin(rad);
    const east = along * Math.sin(rad) + across * Math.cos(rad);
    const distance = Math.hypot(north, east);
    const bearing = (Math.atan2(east, north) * 180) / Math.PI;
    ring.push(offset(centre, bearing, distance));
  }
  ring.push(ring[0] as Position);
  return ring;
}

/**
 * Heading arrow for the longest spread outline: a shaft from the origin to
 * the head fire and two barbs. Empty when there is no spread.
 */
export function spreadArrow(
  spread: FeatureCollection<Polygon, { origin: Position; headingDeg: number; headKm: number }>,
): FeatureCollection<LineString> {
  const longest = spread.features.reduce<(typeof spread.features)[number] | null>(
    (best, f) => (best === null || f.properties.headKm > best.properties.headKm ? f : best),
    null,
  );
  if (!longest) return { type: "FeatureCollection", features: [] };
  const { origin, headingDeg, headKm } = longest.properties;
  const head = offset(origin, headingDeg, headKm);
  const barbKm = Math.min(1.5, headKm * 0.2);
  const line = (coordinates: Position[]) =>
    ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } }) as const;
  return {
    type: "FeatureCollection",
    features: [
      line([origin, head]),
      line([offset(head, headingDeg + 150, barbKm), head, offset(head, headingDeg - 150, barbKm)]),
    ],
  };
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Eight-point compass name for a bearing, e.g. 40 -> "NE". */
export function compassPoint(deg: number): string {
  const index = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return COMPASS[index] ?? "N";
}
