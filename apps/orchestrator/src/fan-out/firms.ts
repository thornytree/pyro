
import { parse } from "csv-parse/sync";
import { createRegionBounds } from "./region.ts";
import { frameBounds, tileIdAt } from "./grid.ts";
import type { BoundingBox, FireDetection, FirmsSource, NationalDetections } from "./types.ts";

// CSV parsers usually return strings; numeric fields may already be parsed by callers.
export type FirmsRow = {
  latitude: string | number;
  longitude: string | number;
  acq_date: string;
  acq_time: string | number;
  satellite: string;
  confidence: string | number;
  frp?: string | number; // absent from Landsat
  scan: string | number;
  track: string | number;
};

export type FirmsDataset = { source: FirmsSource; rows: FirmsRow[] };
type FireAttributes = { fire: { detections: FireDetection[] } };

export const sources: FirmsSource[] = [
  "MODIS_NRT", "VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "LANDSAT_NRT",
];
const baseColumns = ["latitude", "longitude", "acq_date", "acq_time", "satellite", "confidence", "scan", "track"];
function requiredColumns(source: FirmsSource): string[] {
  return source === "LANDSAT_NRT" ? baseColumns : [...baseColumns, "frp"];
}
// Landsat's scan/track columns are pixel positions in the scene, not sizes.
const LANDSAT_PIXEL_KM = 0.03;

function numeric(value: string | number, field: string, min: number, max = Infinity): number {
  const number = typeof value === "number" ? value : Number(value?.trim());
  if (value === undefined || value === null || String(value).trim() === "" ||
      !Number.isFinite(number) || number < min || number > max) {
    throw new Error(`Invalid FIRMS ${field}.`);
  }
  return number;
}

function acquisitionTime(date: string, time: string | number): string {
  const hhmm = String(time).padStart(4, "0");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}$/.test(hhmm) ||
      Number(hhmm.slice(0, 2)) > 23 || Number(hhmm.slice(2)) > 59) {
    throw new Error("Invalid FIRMS acquisition timestamp.");
  }
  const iso = `${date}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00.000Z`;
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== iso) {
    throw new Error("Invalid FIRMS acquisition timestamp.");
  }
  return iso;
}

/** Convert already-parsed FIRMS rows into detections, each tagged with its tile. */
export function normalizeFireAttributes(datasets: FirmsDataset[]): FireAttributes {
  const detections: FireDetection[] = [];
  const seen = new Set<string>();

  for (const { source, rows } of datasets) {
    if (!sources.includes(source)) throw new Error("Unsupported FIRMS source.");
    for (const row of rows) {
      const instrument = source === "MODIS_NRT" ? "MODIS" : source === "LANDSAT_NRT" ? "OLI" : "VIIRS";
      let confidence: FireDetection["confidence"];
      if (instrument === "MODIS") {
        confidence = { kind: "percent", value: numeric(row.confidence, "confidence", 0, 100) };
      } else {
        const category = String(row.confidence).trim().toLowerCase();
        const categories: Record<string, "low" | "nominal" | "high"> = {
          l: "low", n: "nominal", h: "high", low: "low", nominal: "nominal", high: "high",
        };
        const value = Object.hasOwn(categories, category) ? categories[category] : undefined;
        if (!value) throw new Error("Invalid FIRMS VIIRS confidence.");
        confidence = { kind: "category", value };
      }
      if (!row.satellite?.trim()) throw new Error("Missing FIRMS satellite.");
      const isLandsat = instrument === "OLI";
      const latitude = numeric(row.latitude, "latitude", -90, 90);
      const longitude = numeric(row.longitude, "longitude", -180, 180);
      const detection: FireDetection = {
        source,
        instrument,
        satellite: row.satellite.trim(),
        location: { latitude, longitude },
        tile_id: tileIdAt(latitude, longitude),
        observation_time: acquisitionTime(row.acq_date, row.acq_time),
        frp_mw: isLandsat ? null : numeric(row.frp ?? "", "FRP", 0),
        scan_km: isLandsat ? LANDSAT_PIXEL_KM : numeric(row.scan, "scan", 0),
        track_km: isLandsat ? LANDSAT_PIXEL_KM : numeric(row.track, "track", 0),
        confidence,
      };
      // Remove exact repeats, preserving separate satellite passes and sensors.
      const key = JSON.stringify(detection);
      if (!seen.has(key)) {
        seen.add(key);
        detections.push(detection);
      }
    }
  }
  detections.sort((a, b) => a.observation_time.localeCompare(b.observation_time));
  return { fire: { detections } };
}

// The whole CONUS tile frame. FIRMS takes one bounding box per request, so a
// nationwide poll is one request per sensor (decision 2 in docs/handover/decisions.md).
export const CONUS_FRAME = frameBounds();

/**
 * Fetch every FIRMS feed for the whole CONUS frame concurrently; any failed
 * feed fails the poll so a partial snapshot never replaces a complete one.
 * Detections outside the tile frame (Canada, Mexico, ocean) are dropped.
 * Each day in the range counts as one transaction against the MAP_KEY's 5,000
 * per 10 minutes, so a 2-day poll of five feeds costs about 10.
 */
async function fetchFirmsArea(
  bounds: BoundingBox,
  selectedSources: FirmsSource[],
  options: { days?: number; mapKey?: string },
): Promise<FireAttributes> {
  const { west, south, east, north } = bounds;
  const days = options.days ?? 2;
  if (!Number.isInteger(days) || days < 1 || days > 5) {
    throw new Error("FIRMS day range must be an integer between 1 and 5.");
  }
  const mapKey = options.mapKey ?? process.env.FIRMS_MAP_KEY;
  if (!mapKey?.trim()) throw new Error("FIRMS_MAP_KEY is required.");
  const datasets = await Promise.all(selectedSources.map(async (source): Promise<FirmsDataset> => {
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(mapKey)}/${source}/${west},${south},${east},${north}/${days}`;
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    } catch {
      // Do not expose the request URL, which contains the MAP_KEY.
      throw new Error(`FIRMS ${source} request failed or timed out.`);
    }
    if (!response.ok) throw new Error(`FIRMS ${source} returned HTTP ${response.status}.`);
    let rows: FirmsRow[];
    try {
      const csv = await response.text();
      if (!csv.trim()) throw new Error("Empty FIRMS response.");
      const required = requiredColumns(source);
      rows = parse(csv, {
        bom: true,
        skip_empty_lines: true,
        trim: true,
        columns: (headers: string[]) => {
          if (!required.every(column => headers.includes(column))) {
            throw new Error("Missing FIRMS columns.");
          }
          return headers;
        },
      }) as FirmsRow[];
    } catch {
      throw new Error(`FIRMS ${source} returned an invalid CSV response.`);
    }
    // A valid header-only CSV means no detections.
    return { source, rows };
  }));
  return normalizeFireAttributes(datasets);
}

/** The four MODIS/VIIRS feeds for any bounding box (a region or a whole state). */
export async function getFireAttributesIn(
  bounds: BoundingBox,
  options: { days?: number; mapKey?: string } = {},
): Promise<FireAttributes> {
  return fetchFirmsArea(bounds, sources.filter(source => source !== "LANDSAT_NRT"),
    { ...options, days: options.days ?? 1 });
}

/** Request-driven 300-square-mile region. */
async function getFireAttributes(
  lat: number, long: number,
  options: { days?: number; mapKey?: string } = {},
): Promise<FireAttributes> {
  return getFireAttributesIn(createRegionBounds(lat, long), options);
}

export default getFireAttributes

export { createRegionBounds as createFireBounds } from "./region.ts";

/** Nationwide snapshot used only when the optional scheduler is started. */
export async function fetchFirmsNationwide(
  options: { days?: number; mapKey?: string } = {},
): Promise<NationalDetections> {
  const fetchedAt = new Date().toISOString();
  const days = options.days ?? 2;
  const { fire } = await fetchFirmsArea(CONUS_FRAME, sources, { ...options, days });
  return {
    fetched_at: fetchedAt, days,
    detections: fire.detections.filter(detection => detection.tile_id !== null),
  };
}
