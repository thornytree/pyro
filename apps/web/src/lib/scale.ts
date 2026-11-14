/** Web Mercator earth circumference at the equator, in metres. */
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
/** MapLibre renders 512 px tiles. */
const TILE_SIZE_PX = 512;
const METRES_PER_MILE = 1609.344;
const METRES_PER_FOOT = 0.3048;

/** Ground distance covered by one CSS pixel at a latitude and zoom. */
export function metresPerPixel(latitude: number, zoom: number): number {
  return (
    (EARTH_CIRCUMFERENCE_M * Math.cos((latitude * Math.PI) / 180)) /
    (TILE_SIZE_PX * 2 ** zoom)
  );
}

/** The largest 1, 2 or 5 x 10^n that is at most `value`. */
export function niceNumber(value: number): number {
  if (!(value > 0)) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const leading = value / magnitude;
  // Guard against floating point putting 1000 at 999.999...
  const step = leading >= 5 - 1e-9 ? 5 : leading >= 2 - 1e-9 ? 2 : 1;
  return step * magnitude;
}

export interface ScaleBar {
  /** Bar length in CSS pixels. */
  widthPx: number;
  label: string;
}

/**
 * A scale bar no wider than `maxWidthPx`, in metric or imperial units.
 * Switches to the smaller unit (m, ft) below 1 km or 1 mile.
 */
export function scaleBar(
  metresPerPx: number,
  maxWidthPx: number,
  unit: "metric" | "imperial",
): ScaleBar {
  const maxMetres = metresPerPx * maxWidthPx;
  const [big, bigLabel, small, smallLabel] =
    unit === "metric"
      ? [1000, "km", 1, "m"]
      : [METRES_PER_MILE, "mi", METRES_PER_FOOT, "ft"];
  const useBig = maxMetres >= big;
  const factor = useBig ? big : small;
  const distance = niceNumber(maxMetres / factor);
  return {
    widthPx: (distance * factor) / metresPerPx,
    label: `${distance.toLocaleString("en-US")} ${useBig ? bigLabel : smallLabel}`,
  };
}
