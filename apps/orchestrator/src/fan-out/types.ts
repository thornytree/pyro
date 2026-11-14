export type dataBundle = {
  location: {
    latitude: number
    longitude: number
  }
  observation_time: string
  fire: {
    detections: FireDetection[]
  }
  weather: {
    wind_speed_kph: number
    wind_direction: number
    temperature: number
    humidity: number
  }
  terrain: {
    elevation_m: number
    slope: number
  }
  vegetation: {
    fuelType: string
  }
}

export type FirmsSource =
  | "MODIS_NRT"
  | "VIIRS_SNPP_NRT"
  | "VIIRS_NOAA20_NRT"
  | "VIIRS_NOAA21_NRT";

export type FireDetection = {
  source: FirmsSource;
  instrument: "MODIS" | "VIIRS";
  satellite: string;
  location: dataBundle["location"];
  observation_time: string; // Acquisition time in UTC
  frp_mw: number;
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
