import { getWeatherAttributes } from "./meteo.ts";
import { getFireAttributes } from "./firms.ts";
import { getDaymetAttributes } from "./daymet.ts";
import { getTerrainAttributes } from "./terrain.ts";
import { getVegetationAttributes } from "./landfire.ts";
import type { dataBundle, LandfireVersion } from "./types.ts";

export type FanOutOptions = {
  forecastHours?: number;
  landfireVersion?: LandfireVersion;
  daymet: { startDate: string; endDate: string };
};

// All five sources cover the same centered 300-square-mile region.
export async function fanOutEntry(
  lat: number,
  long: number,
  options: FanOutOptions,
): Promise<dataBundle> {
  const [weatherResult, fireResult, daymetResult, terrainResult, vegetationResult] = await Promise.all([
    getWeatherAttributes(lat, long, { forecastHours: options.forecastHours }),
    getFireAttributes(lat, long),
    getDaymetAttributes(lat, long, options.daymet.startDate, options.daymet.endDate),
    getTerrainAttributes(lat, long),
    getVegetationAttributes(lat, long, { version: options.landfireVersion }),
  ]);

  const bundle: dataBundle = {
    location: { latitude: lat, longitude: long },
    observation_time: weatherResult.observation_time,
    weather: weatherResult.weather,
    weather_grid: weatherResult.weather_grid,
    fire: fireResult.fire,
    historical_weather: daymetResult.historical_weather,
    terrain: terrainResult.terrain,
    vegetation: vegetationResult.vegetation,
  };
  return bundle;
}


import { tileIdAt } from "./grid.ts";
import type { Ingestion } from "./scheduler.ts";
import type { TileBundle } from "./types.ts";

// User trigger (work item 1). Under decision 2 a request never fetches external
// data itself: it snaps the point to its 50 km tile, marks the tile active and
// returns whatever the scheduler has cached ("queued" until weather arrives).
export function requestTileAt(ingestion: Ingestion, lat: number, long: number): TileBundle {
  const tileId = tileIdAt(lat, long);
  if (!tileId) throw new Error("Point is outside the supported area (CONUS).");
  return ingestion.requestTile(tileId);
}
