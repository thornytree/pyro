export type LatLon = {
  latitude: number;
  longitude: number;
};

export type BoundingBox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type FirmsSource =
  | "MODIS_NRT"
  | "VIIRS_SNPP_NRT"
  | "VIIRS_NOAA20_NRT"
  | "VIIRS_NOAA21_NRT"
  | "LANDSAT_NRT"; // US/Canada only

export type FireDetection = {
  source: FirmsSource;
  instrument: "MODIS" | "VIIRS" | "OLI";
  satellite: string;
  location: LatLon;
  tile_id: string | null; // 50 km tile (grid.ts); null outside the CONUS frame
  observation_time: string; // Acquisition time in UTC
  frp_mw: number | null; // Landsat reports no FRP
  scan_km: number;
  track_km: number; // Landsat: nominal 30 m pixel; the feed's scan/track are pixel positions
  confidence:
    | { kind: "percent"; value: number }
    | { kind: "category"; value: "low" | "nominal" | "high" };
};

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
