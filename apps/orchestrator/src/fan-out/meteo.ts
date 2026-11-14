import { fetchWeatherApi } from "openmeteo";
import { tileSamplePoints } from "./grid.ts";
import type { TileWeather, WeatherPoint } from "./types.ts";

// Weather is the expensive source (it is fetched per point), so under decision 2
// it runs only for active tiles, sampled about every 10 km inside the tile
// (25 points) and interpolated downstream. All points go in one request.
export const WEATHER_SPACING_M = 10_000;

export async function getTileWeather(tileId: string, spacingM = WEATHER_SPACING_M): Promise<TileWeather> {
  const points = tileSamplePoints(tileId, spacingM);

  // The variable order must match the indices read below.
  // Model is left to Open-Meteo's best match; never request HRRR by name (discontinued 2026-11-30).
  const responses = await fetchWeatherApi("https://api.open-meteo.com/v1/forecast", {
    latitude: points.map(p => p.latitude),
    longitude: points.map(p => p.longitude),
    current: ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "wind_direction_10m"],
    temperature_unit: "celsius",
    wind_speed_unit: "kmh",
    timezone: "GMT",
  });
  if (responses.length !== points.length) {
    throw new Error(`Open-Meteo returned ${responses.length} locations for ${points.length} points.`);
  }

  let observationTime = "";
  const readings: WeatherPoint[] = responses.map((response, i) => {
    const current = response.current();
    if (!current) throw new Error("Open-Meteo returned no current weather data.");
    const readValue = (index: number, name: string): number => {
      const value = current.variables(index)?.value();
      if (value === undefined || !Number.isFinite(value)) {
        throw new Error(`Open-Meteo returned missing or invalid ${name}.`);
      }
      return value;
    };
    const elevation = response.elevation();
    if (!Number.isFinite(elevation)) throw new Error("Open-Meteo returned invalid elevation.");
    observationTime ||= new Date(Number(current.time()) * 1000).toISOString();
    return {
      // Report the requested sample point; Open-Meteo snaps to its own model grid.
      location: points[i]!,
      temperature: readValue(0, "temperature"),
      humidity: readValue(1, "relative humidity"),
      wind_speed_kph: readValue(2, "wind speed"),
      wind_direction: readValue(3, "wind direction"),
      elevation_m: elevation,
    };
  });

  return { tile_id: tileId, observation_time: observationTime, spacing_m: spacingM, points: readings };
}
