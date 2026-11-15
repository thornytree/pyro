import proj4 from "proj4";
import { NetCDFReader } from "netcdfjs";
import { createRegionBounds, createRegionGrid } from "./region.ts";
import type { BoundingBox, dataBundle, DaymetGrid, DaymetVariable } from "./types.ts";

const variables: DaymetVariable[] = ["tmin", "tmax", "prcp", "vp", "srad", "swe", "dayl"];
const units: Record<DaymetVariable, string> = {
  tmin: "degrees C", tmax: "degrees C", prcp: "mm/day", vp: "Pa",
  srad: "W/m2", swe: "kg/m2", dayl: "s",
};
type Attribute = { name: string; value: string | number | number[] };

function dateValue(value: string): number {
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value) throw new Error("Invalid Daymet date; use YYYY-MM-DD.");
  return date.getTime();
}

const baseUrl = "https://opendap.earthdata.nasa.gov/collections/C2532426483-ORNL_CLOUD/granules";
const metadataCache = new Map<number, Promise<NetCDFReader>>();

function attributeOf(reader: NetCDFReader, name: string, key: string) {
  const variable = reader.variables.find(v => v.name === name);
  return (variable?.attributes as Attribute[] | undefined)?.find(a => a.name === key)?.value;
}

function datesOf(reader: NetCDFReader): string[] {
  const units = String(attributeOf(reader, "time", "units"));
  const match = /^(days|hours|seconds) since (\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?(?: ?(?:UTC|Z))?$/.exec(units);
  const calendar = attributeOf(reader, "time", "calendar");
  if (!match || (calendar && !["standard", "gregorian", "proleptic_gregorian"].includes(String(calendar)))) {
    throw new Error("Unsupported Daymet time units or calendar.");
  }
  const origin = Date.parse(`${match[2]}T${match[3] ?? "00:00:00"}Z`);
  const multiplier = match[1] === "days" ? 86400000 : match[1] === "hours" ? 3600000 : 1000;
  return (reader.getDataVariable("time").flat(Infinity) as number[])
    .map(time => new Date(origin + time * multiplier).toISOString().slice(0, 10));
}

async function downloadDaymet(variable: DaymetVariable, year: number, constraint: string, token?: string): Promise<ArrayBuffer> {
  const url = new URL(`${baseUrl}/Daymet_Daily_V4R1.daymet_v4_daily_na_${variable}_${year}.nc.dap.nc`);
  url.searchParams.set("dap4.ce", constraint);
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(60_000),
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch (cause) {
    throw new Error(`Daymet ${variable}/${year} request failed.`, { cause });
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(`Daymet returned HTTP ${response.status}; requires authorized NASA Earthdata access; configure EARTHDATA_TOKEN.`);
  }
  if (!response.ok) throw new Error(`Daymet ${variable}/${year} returned HTTP ${response.status}; check dataset availability.`);
  return response.arrayBuffer();
}

async function metadataFor(year: number, token?: string): Promise<NetCDFReader> {
  const cached = metadataCache.get(year);
  if (cached) return cached;
  const result = downloadDaymet("tmin", year, "/x;/y;/time;/lambert_conformal_conic", token)
    .then(bytes => {
      try { return new NetCDFReader(bytes); }
      catch (cause) { throw new Error("Daymet returned invalid NetCDF metadata.", { cause }); }
    });
  if (metadataCache.size >= 8) metadataCache.delete(metadataCache.keys().next().value!);
  metadataCache.set(year, result);
  try { return await result; }
  catch (error) { metadataCache.delete(year); throw error; }
}

/** Convert geographic bounds to native Daymet LCC grid indices, with a border. */
export function daymetIndices(reader: NetCDFReader, bounds: BoundingBox) {
  const name = "lambert_conformal_conic";
  const parallels = attributeOf(reader, name, "standard_parallel");
  if (attributeOf(reader, name, "grid_mapping_name") !== name || !Array.isArray(parallels) || parallels.length !== 2) {
    throw new Error("Unsupported Daymet projection metadata.");
  }
  const number = (key: string): number => {
    const result = Number(attributeOf(reader, name, key));
    if (!Number.isFinite(result)) throw new Error("Invalid Daymet projection metadata.");
    return result;
  };
  const projection = `+proj=lcc +lat_1=${parallels[0]} +lat_2=${parallels[1]} +lat_0=${number("latitude_of_projection_origin")} +lon_0=${number("longitude_of_central_meridian")} +x_0=${number("false_easting")} +y_0=${number("false_northing")} +a=${number("semi_major_axis")} +rf=${number("inverse_flattening")} +units=m +no_defs`;
  const points: number[][] = [];
  for (let step = 0; step <= 100; step++) {
    const lon = bounds.west + (bounds.east - bounds.west) * step / 100;
    const lat = bounds.south + (bounds.north - bounds.south) * step / 100;
    for (const pair of [[lon, bounds.south], [lon, bounds.north], [bounds.west, lat], [bounds.east, lat]]) {
      points.push(proj4("EPSG:4326", projection, pair));
    }
  }
  const range = (axisName: "x" | "y", coordinate: number) => {
    const axis = reader.getDataVariable(axisName).flat(Infinity) as number[];
    const step = axis[1]! - axis[0]!;
    if (axis.length < 2 || !axis.every(Number.isFinite) || Math.abs(Math.abs(step) - 1000) > 0.1) {
      throw new Error("Unsupported Daymet grid axes.");
    }
    const indices = points.map(point => (point[coordinate]! - axis[0]!) / step);
    const first = Math.floor(Math.min(...indices)) - 1;
    const last = Math.ceil(Math.max(...indices)) + 1;
    if (last < 0 || first >= axis.length) throw new Error("Requested bounds are outside Daymet coverage.");
    return [Math.max(0, first), Math.min(axis.length - 1, last)] as const;
  };
  return { x: range("x", 0), y: range("y", 1) };
}

/** Decode a regional NetCDF3 response into JSON-safe, time-major grid values. */
export function normalizeDaymetAttributes(
  data: ArrayBuffer,
  variable: DaymetVariable,
  year: number,
  bounds: BoundingBox,
  startDate: string,
  endDate: string,
): DaymetGrid {
  const reader = new NetCDFReader(data);
  function metadata(name: string) {
    const result = reader.variables.find(v => v.name === name);
    if (!result) throw new Error(`Daymet is missing ${name}.`);
    return result;
  }
  function attribute(name: string, key: string) {
    return (metadata(name).attributes as Attribute[]).find(a => a.name === key)?.value;
  }
  function numbers(name: string): number[] {
    const values = reader.getDataVariable(name).flat(Infinity);
    if (!values.every(value => typeof value === "number" && Number.isFinite(value))) {
      throw new Error(`Daymet returned invalid ${name} values.`);
    }
    return values as number[];
  }
  function dimensionNames(name: string) {
    return metadata(name).dimensions.map(id => reader.dimensions[id]?.name).join(",");
  }
  if (dimensionNames(variable) !== "time,y,x" || dimensionNames("lat") !== "y,x" ||
      dimensionNames("lon") !== "y,x") throw new Error("Unsupported Daymet grid dimensions.");
  const rows = reader.dimensions.find(d => d.name === "y")?.size;
  const columns = reader.dimensions.find(d => d.name === "x")?.size;
  if (!rows || !columns) throw new Error("Daymet returned an empty grid.");
  const latitudes = numbers("lat");
  const longitudes = numbers("lon");
  const time = numbers("time");
  const values = reader.getDataVariable(variable).flat(Infinity) as number[];
  const cellCount = rows * columns;
  if (latitudes.length !== cellCount || longitudes.length !== cellCount ||
      values.length !== cellCount * time.length) throw new Error("Daymet returned incomplete grid data.");
  const dates = datesOf(reader);
  const selected = dates.flatMap((date, index) => date >= startDate && date <= endDate ? [index] : []);
  if (!selected.length) throw new Error("Daymet returned no days in the requested range.");
  const fill = attribute(variable, "_FillValue");
  const missing = attribute(variable, "missing_value");
  const scale = Number(attribute(variable, "scale_factor") ?? 1);
  const offset = Number(attribute(variable, "add_offset") ?? 0);
  if (!Number.isFinite(scale) || !Number.isFinite(offset)) throw new Error("Invalid Daymet scaling.");
  const inside = latitudes.map((lat, i) => lat >= bounds.south && lat <= bounds.north &&
    longitudes[i]! >= bounds.west && longitudes[i]! <= bounds.east);
  if (!inside.some(Boolean)) throw new Error("Daymet returned no cells within the requested bounds.");
  const target = createRegionGrid((bounds.north + bounds.south) / 2, (bounds.east + bounds.west) / 2, 1);
  const candidates = inside.flatMap((valid, index) => valid ? [index] : []);
  const sampleIndices = target.cells.map(point => {
    const longitudeWeight = Math.cos(point.latitude * Math.PI / 180) ** 2;
    let nearest = candidates[0]!;
    let distance = Infinity;
    for (const index of candidates) {
      const candidateDistance = (point.latitude - latitudes[index]!) ** 2 +
        longitudeWeight * (point.longitude - longitudes[index]!) ** 2;
      if (candidateDistance < distance) { nearest = index; distance = candidateDistance; }
    }
    return nearest;
  });
  return {
    variable, year, units: String(attribute(variable, "units") ?? units[variable]),
    dates: selected.map(i => dates[i]!), rows, columns, latitudes, longitudes,
    sample_indices: sampleIndices,
    values: selected.flatMap(day => Array.from({ length: cellCount }, (_, cell) => {
      const value = values[day * cellCount + cell];
      if (!inside[cell] || typeof value !== "number" || !Number.isFinite(value) ||
          value === fill || value === missing) return null;
      const scaled = value * scale + offset;
      return Number.isFinite(scaled) ? scaled : null;
    })),
  };
}

/** Historical training adapter: one cached metadata request plus seven regional requests per year, never one per pixel. */
export async function getDaymetAttributes(
  lat: number,
  long: number,
  startDate: string,
  endDate: string,
  options: { token?: string } = {},
): Promise<Pick<dataBundle, "historical_weather">> {
  const bounds = createRegionBounds(lat, long);
  const { rows, columns, cells } = createRegionGrid(lat, long, 1);
  const start = dateValue(startDate);
  const end = dateValue(endDate);
  if (start > end || startDate < "1980-01-01" || end >= Date.now()) {
    throw new Error("Daymet requires an ordered historical date range starting in 1980 or later.");
  }
  const token = options.token ?? process.env.EARTHDATA_TOKEN;
  const grids: DaymetGrid[] = [];
  // Bound request concurrency to seven, even for training ranges spanning multiple years.
  for (let year = Number(startDate.slice(0, 4)); year <= Number(endDate.slice(0, 4)); year++) {
    const first = startDate > `${year}-01-01` ? startDate : `${year}-01-01`;
    const last = endDate < `${year}-12-31` ? endDate : `${year}-12-31`;
    const metadata = await metadataFor(year, token);
    const { x, y } = daymetIndices(metadata, bounds);
    const availableDates = datesOf(metadata);
    const selectedDays = availableDates.flatMap((date, index) => date >= first && date <= last ? [index] : []);
    if (!selectedDays.length) throw new Error("Daymet returned no days in the requested range.");
    const timeSlice = `[${selectedDays[0]}:1:${selectedDays.at(-1)}]`;
    const ySlice = `[${y[0]}:1:${y[1]}]`;
    const xSlice = `[${x[0]}:1:${x[1]}]`;
    const yearGrids = await Promise.all(variables.map(async variable => {
      const constraint = `/x${xSlice};/y${ySlice};/time${timeSlice};/lat${ySlice}${xSlice};/lon${ySlice}${xSlice};/${variable}${timeSlice}${ySlice}${xSlice}`;
      const bytes = await downloadDaymet(variable, year, constraint, token);
      try {
        return normalizeDaymetAttributes(bytes, variable, year, bounds, first, last);
      } catch (error) {
        throw new Error(`Daymet ${variable}/${year} returned invalid or unsupported NetCDF data.`, { cause: error });
      }
    }));
    grids.push(...yearGrids);
  }
  return {
    historical_weather: {
      source: "Daymet V4 R1", source_resolution_km: 1, bounds,
      start_date: startDate, end_date: endDate, grid: { rows, columns, cells }, grids,
    },
  };
}
