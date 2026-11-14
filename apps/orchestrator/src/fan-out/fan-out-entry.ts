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
