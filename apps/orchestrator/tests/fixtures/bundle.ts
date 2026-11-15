import { createRegionGrid } from "../../src/fan-out/region.js";
import type { dataBundle, WeatherValues } from "../../src/fan-out/types.ts";

export function makeBundle(location = { latitude: 34.05, longitude: -118.25 }): dataBundle {
  const { bounds, rows, columns, cells } = createRegionGrid(location.latitude, location.longitude, 1);
  const observation_time = "2026-11-14T12:00:00.000Z";
  const weather: WeatherValues = {
    temperature: 20, humidity: 50, wind_speed_kph: 10, wind_direction: 270,
    precipitation_mm: 0, wind_gusts_kph: 15, vapour_pressure_deficit_kpa: 1,
    shortwave_radiation_w_m2: 300,
  };
  const terrain = { elevation_m: 100, slope_degrees: 5, aspect_degrees: 180 };
  const vegetation = {
    fuel_model_code: 101, vegetation_type_code: 7111, canopy_cover_pct: 0,
    canopy_height_m: 0, canopy_base_height_m: 0, canopy_bulk_density_kg_m3: 0,
  };
  return {
    location, observation_time, weather,
    weather_grid: {
      source: "Open-Meteo", model: "ncep_rrfs_conus", source_resolution_km: 3,
      bounds, rows, columns, resampling: "nearest", cells: cells.map(cell => ({ ...cell, sample_index: 0 })),
      samples: [{ requested_location: location, source_location: location, elevation_m: 100, observation_time, current: weather, hourly: [] }],
    },
    fire: { detections: [
      { source: "MODIS_NRT", instrument: "MODIS", satellite: "Terra", location, tile_id: "r24c07", observation_time,
        frp_mw: 12, scan_km: 1, track_km: 1, confidence: { kind: "percent", value: 80 } },
      { source: "VIIRS_SNPP_NRT", instrument: "VIIRS", satellite: "N", location, tile_id: "r24c07", observation_time,
        frp_mw: 8, scan_km: 0.4, track_km: 0.4, confidence: { kind: "category", value: "nominal" } },
    ] },
    historical_weather: {
      source: "Daymet V4 R1", source_resolution_km: 1, bounds, start_date: "2020-07-01",
      end_date: "2020-07-31", grid: { rows, columns, cells }, grids: [],
    },
    terrain: {
      ...terrain, source: "USGS 3DEP", source_url: "https://example.test/terrain", dem_sampling_m: 30,
      slope_method: "Horn 3x3", fetched_at: observation_time,
      grid: { bounds, rows, columns, cells: cells.map(cell => ({ ...cell, ...terrain })) },
    },
    vegetation: {
      source: "LANDFIRE", version: "LF2025", source_resolution_m: 30, resampling: "nearest",
      fuel_model_system: "Scott and Burgan 40", source_urls: [], fetched_at: observation_time,
      grid: { bounds, rows, columns, cells: cells.map(cell => ({ ...cell, ...vegetation })) },
    },
    source_failures: [],
  };
}
