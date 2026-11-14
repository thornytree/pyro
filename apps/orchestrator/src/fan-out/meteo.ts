import { fetchWeatherApi } from "openmeteo";
import type { dataBundle } from "./types.ts";

type WeatherAttributes = Pick<dataBundle, "location" | "observation_time" | "weather"> & {
  terrain: Pick<dataBundle["terrain"], "elevation_m">;
};

export async function getWeatherAttributes(lat: number, long: number): Promise<WeatherAttributes> {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error("Latitude must be between -90 and 90.");
  }
  if (!Number.isFinite(long) || long < -180 || long > 180) {
    throw new Error("Longitude must be between -180 and 180.");
  }

  // The variable order must match the indices read below.
  const responses = await fetchWeatherApi("https://api.open-meteo.com/v1/forecast", {
    latitude: lat,
    longitude: long,
    current: ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "wind_direction_10m"],
    temperature_unit: "celsius",
    wind_speed_unit: "kmh",
    timezone: "GMT",
  });
  const response = responses[0];
  const current = response?.current();
  if (!response || !current) {
    throw new Error("Open-Meteo returned no current weather data.");
  }

  function readValue(index: number, name: string): number {
    const value = current!.variables(index)?.value();
    if (value === undefined || !Number.isFinite(value)) {
      throw new Error(`Open-Meteo returned missing or invalid ${name}.`);
    }
    return value;
  }

  const elevation = response.elevation();
  if (!Number.isFinite(elevation)) {
    throw new Error("Open-Meteo returned invalid elevation.");
  }

  return {
    location: {
      latitude: response.latitude(),
      longitude: response.longitude(),
    },
    observation_time: new Date(Number(current.time()) * 1000).toISOString(),
    weather: {
      temperature: readValue(0, "temperature"), // Celsius
      humidity: readValue(1, "relative humidity"), // Percent
      wind_speed_kph: readValue(2, "wind speed"),
      wind_direction: readValue(3, "wind direction"), // Degrees clockwise from north; wind comes from
    },
    terrain: {
      elevation_m: elevation,
    },
  };
}
