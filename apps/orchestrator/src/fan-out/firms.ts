
import { parse } from "csv-parse/sync";
import { createRegionBounds } from "./region.ts";
import type { dataBundle, FireDetection, FirmsSource } from "./types.ts";

// CSV parsers usually return strings; numeric fields may already be parsed by callers.
export type FirmsRow = {
  latitude: string | number;
  longitude: string | number;
  acq_date: string;
  acq_time: string | number;
  satellite: string;
  confidence: string | number;
  frp: string | number;
  scan: string | number;
  track: string | number;
};

export type FirmsDataset = { source: FirmsSource; rows: FirmsRow[] };
type FireAttributes = Pick<dataBundle, "fire">;

const sources: FirmsSource[] = [
  "MODIS_NRT", "VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT",
];
const requiredColumns = [
  "latitude", "longitude", "acq_date", "acq_time", "satellite", "confidence", "frp", "scan", "track",
];

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

/** Convert already-parsed MODIS/VIIRS rows into the fire portion of a bundle. */
export function normalizeFireAttributes(datasets: FirmsDataset[]): FireAttributes {
  const detections: FireDetection[] = [];
  const seen = new Set<string>();

  for (const { source, rows } of datasets) {
    if (!sources.includes(source)) throw new Error("Unsupported FIRMS source.");
    for (const row of rows) {
      const instrument = source === "MODIS_NRT" ? "MODIS" : "VIIRS";
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
      const detection: FireDetection = {
        source,
        instrument,
        satellite: row.satellite.trim(),
        location: {
          latitude: numeric(row.latitude, "latitude", -90, 90),
          longitude: numeric(row.longitude, "longitude", -180, 180),
        },
        observation_time: acquisitionTime(row.acq_date, row.acq_time),
        frp_mw: numeric(row.frp, "FRP", 0),
        scan_km: numeric(row.scan, "scan", 0),
        track_km: numeric(row.track, "track", 0),
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

// Backward-compatible name; all sources use the same region.
export { createRegionBounds as createFireBounds } from "./region.ts";

/** Fetch all four FIRMS feeds concurrently; any failed feed fails this operation. */
export async function getFireAttributes(
  lat: number,
  long: number,
  options: { days?: number; mapKey?: string } = {},
): Promise<FireAttributes> {
  const { west, south, east, north } = createRegionBounds(lat, long);
  const days = options.days ?? 1;
  if (!Number.isInteger(days) || days < 1 || days > 5) {
    throw new Error("FIRMS day range must be an integer between 1 and 5.");
  }
  const mapKey = options.mapKey ?? process.env.FIRMS_MAP_KEY;
  if (!mapKey?.trim()) throw new Error("FIRMS_MAP_KEY is required.");

  const datasets = await Promise.all(sources.map(async (source): Promise<FirmsDataset> => {
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(mapKey)}/${source}/${west},${south},${east},${north}/${days}`;
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    } catch {
      // Do not expose the request URL, which contains the MAP_KEY.
      throw new Error(`FIRMS ${source} request failed or timed out.`);
    }
    if (!response.ok) throw new Error(`FIRMS ${source} returned HTTP ${response.status}.`);
    let rows: FirmsRow[];
    try {
      const csv = await response.text();
      if (!csv.trim()) throw new Error("Empty FIRMS response.");
      rows = parse(csv, {
        bom: true,
        skip_empty_lines: true,
        trim: true,
        columns: (headers: string[]) => {
          if (!requiredColumns.every(column => headers.includes(column))) {
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
