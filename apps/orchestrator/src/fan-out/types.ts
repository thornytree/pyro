export type dataBundle = {
  location: {
    latitude: number
    longitude: number
  }
  observation_time: string
  fire: {
    detections: FireDetection[]
  }
  weather: WeatherValues
  weather_grid: WeatherGrid
  historical_weather: HistoricalWeather
  terrain: TerrainAttributes
  vegetation: VegetationAttributes
}

export type FirmsSource =
  | "MODIS_NRT"
  | "VIIRS_SNPP_NRT"
  | "VIIRS_NOAA20_NRT"
  | "VIIRS_NOAA21_NRT"
  | "LANDSAT_NRT";

export type FireDetection = {
  source: FirmsSource;
  instrument: "MODIS" | "VIIRS" | "OLI";
  satellite: string;
  location: dataBundle["location"];
  tile_id: string | null; // Optional scheduler grid assignment; null outside its frame
  observation_time: string; // Acquisition time in UTC
  frp_mw: number | null; // Landsat does not report FRP
  scan_km: number;
  track_km: number;
  confidence:
    | { kind: "percent"; value: number }
    | { kind: "category"; value: "low" | "nominal" | "high" };
};

export type BoundingBox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type WeatherValues = {
  temperature: number; // Celsius
  humidity: number; // Percent
  wind_speed_kph: number;
  wind_direction: number; // Degrees clockwise from north, direction wind comes from
  precipitation_mm: number; // Preceding-hour total
  wind_gusts_kph: number;
  vapour_pressure_deficit_kpa: number;
  shortwave_radiation_w_m2: number; // Preceding-hour mean
};

export type WeatherGrid = {
  source: "Open-Meteo";
  model: "ncep_rrfs_conus";
  source_resolution_km: 3;
  bounds: BoundingBox;
  rows: number;
  columns: number;
  // Row-major, north to south, west to east. Values use nearest sampled weather point.
  resampling: "nearest";
  cells: Array<dataBundle["location"] & { sample_index: number }>;
  samples: Array<{
    requested_location: dataBundle["location"];
    source_location: dataBundle["location"];
    elevation_m: number;
    observation_time: string;
    current: WeatherValues;
    hourly: Array<WeatherValues & { time: string }>;
  }>;
};

export type DaymetVariable = "tmin" | "tmax" | "prcp" | "vp" | "srad" | "swe" | "dayl";
export type DaymetGrid = {
  variable: DaymetVariable;
  units: string;
  year: number;
  dates: string[]; // Daily periods, not instantaneous UTC observations
  rows: number;
  columns: number;
  latitudes: number[];
  longitudes: number[];
  // Time-major then row-major [day, y, x]; null means missing or outside bounds.
  values: Array<number | null>;
  // For each common-grid cell, index into one day of the native source grid.
  sample_indices: number[];
};
export type HistoricalWeather = {
  source: "Daymet V4 R1";
  source_resolution_km: 1;
  bounds: BoundingBox;
  start_date: string;
  end_date: string;
  grid: { rows: number; columns: number; cells: dataBundle["location"][] };
  grids: DaymetGrid[];
};


export type TerrainValues = {
  elevation_m: number | null;
  slope_degrees: number | null;
  aspect_degrees: number | null; // Downhill compass bearing; null for flat/unknown cells
};
export type TerrainAttributes = TerrainValues & {
  source: "USGS 3DEP";
  source_url: string;
  dem_sampling_m: 30;
  slope_method: "Horn 3x3";
  fetched_at: string;
  grid: {
    bounds: BoundingBox;
    rows: number;
    columns: number;
    cells: Array<dataBundle["location"] & TerrainValues>;
  };
};
export type LandfireVersion = "LF2020" | "LF2022" | "LF2023" | "LF2024" | "LF2025";
export type VegetationValues = {
  fuel_model_code: number | null;
  vegetation_type_code: number | null;
  canopy_cover_pct: number | null;
  canopy_height_m: number | null;
  canopy_base_height_m: number | null;
  canopy_bulk_density_kg_m3: number | null;
};
export type VegetationAttributes = {
  source: "LANDFIRE";
  version: LandfireVersion;
  source_resolution_m: 30;
  resampling: "nearest";
  fuel_model_system: "Scott and Burgan 40";
  source_urls: string[];
  fetched_at: string;
  grid: {
    bounds: BoundingBox;
    rows: number;
    columns: number;
    cells: Array<dataBundle["location"] & VegetationValues>;
  };
};


export type LatLon = { latitude: number; longitude: number };

/** One FIRMS poll across the whole CONUS frame. Replaced wholesale on each poll. */
export type NationalDetections = {
  fetched_at: string;
  days: number;
  detections: FireDetection[];
};

export type WeatherPoint = {
  location: LatLon;
  temperature: number; // Celsius
  humidity: number; // Percent
  wind_speed_kph: number;
  wind_direction: number; // Degrees clockwise from north; direction the wind comes from
  elevation_m: number;
};

/** Current weather sampled on a coarse grid inside one tile. */
export type TileWeather = {
  tile_id: string;
  observation_time: string;
  spacing_m: number;
  points: WeatherPoint[];
};

/** Everything the orchestrator holds for one active tile. */
export type TileBundle = {
  tile_id: string;
  status: "ready" | "queued";
  fire: { fetched_at: string | null; detections: FireDetection[] };
  weather: TileWeather | null;
};
