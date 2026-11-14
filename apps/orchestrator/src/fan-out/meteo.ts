import { fetchWeatherApi } from "openmeteo";
import { createRegionGrid } from "./region.ts";
import type { dataBundle, WeatherGrid, WeatherValues } from "./types.ts";

type WeatherAttributes = Pick<dataBundle, "location" | "observation_time" | "weather" | "weather_grid"> & {
  terrain: Pick<dataBundle["terrain"], "elevation_m">;
};
const variables = [
  "temperature_2m", "relative_humidity_2m", "wind_speed_10m", "wind_direction_10m",
  "precipitation", "wind_gusts_10m", "vapour_pressure_deficit", "shortwave_radiation",
];
const fields: Array<keyof WeatherValues> = [
  "temperature", "humidity", "wind_speed_kph", "wind_direction",
  "precipitation_mm", "wind_gusts_kph", "vapour_pressure_deficit_kpa", "shortwave_radiation_w_m2",
];
const model = "ncep_rrfs_conus" as const;

function weatherValues(read: (index: number) => number | undefined): WeatherValues {
  return Object.fromEntries(fields.map((field, index) => {
    const value = read(index);
    if (value === undefined || !Number.isFinite(value)) {
      throw new Error(`Open-Meteo returned missing or invalid ${field}.`);
    }
    return [field, value];
  })) as WeatherValues;
}

/** Fetch regional NOAA forecasts, sampled at ~3 km and mapped to a ~1 km grid. */
export async function getWeatherAttributes(
  lat: number,
  long: number,
  options: { forecastHours?: number } = {},
): Promise<WeatherAttributes> {
  const forecastHours = options.forecastHours ?? 24;
  if (!Number.isInteger(forecastHours) || forecastHours < 1 || forecastHours > 72) {
    throw new Error("Forecast hours must be an integer between 1 and 72.");
  }
  const target = createRegionGrid(lat, long, 1);
  const coarse = createRegionGrid(lat, long, 3);
  // Include the selected point first to preserve the existing point-weather fields.
  const points = [{ latitude: lat, longitude: long }, ...coarse.cells];
  const batches = Array.from({ length: Math.ceil(points.length / 50) }, (_, index) =>
    points.slice(index * 50, (index + 1) * 50));
  const results = await Promise.all(batches.map(async points => {
    const responses = await fetchWeatherApi("https://api.open-meteo.com/v1/forecast", {
      latitude: points.map(point => point.latitude),
      longitude: points.map(point => point.longitude),
      models: model,
      current: variables,
      hourly: variables,
      forecast_hours: forecastHours,
      temperature_unit: "celsius",
      wind_speed_unit: "kmh",
      precipitation_unit: "mm",
      timezone: "GMT",
      cell_selection: "nearest",
    }, 3, 0.2, 2, { signal: AbortSignal.timeout(60_000) });
    if (responses.length !== points.length) throw new Error("Open-Meteo returned incomplete grid coverage.");
    return responses.map((response, index): WeatherGrid["samples"][number] => {
      const current = response.current();
      const hourly = response.hourly();
      if (!current || !hourly) throw new Error("Open-Meteo returned no current or hourly weather data.");
      // Open-Meteo SDK model ID 156 identifies ncep_rrfs_conus.
      if (response.model() !== 156) throw new Error("Open-Meteo returned an unexpected weather model.");
      const elevation = response.elevation();
      const latitude = response.latitude();
      const longitude = response.longitude();
      if (![elevation, latitude, longitude].every(Number.isFinite)) {
        throw new Error("Open-Meteo returned invalid grid metadata.");
      }
      const step = hourly.interval();
      const length = (Number(hourly.timeEnd()) - Number(hourly.time())) / step;
      if (step !== 3600 || !Number.isInteger(length) || length !== forecastHours) {
        throw new Error("Open-Meteo returned incomplete hourly forecasts.");
      }
      const arrays = variables.map((_, i) => hourly.variables(i)?.valuesArray());
      if (arrays.some(array => !array || array.length !== length)) {
        throw new Error("Open-Meteo returned incomplete weather variables.");
      }
      return {
        requested_location: points[index]!,
        source_location: { latitude, longitude },
        elevation_m: elevation,
        observation_time: new Date(Number(current.time()) * 1000).toISOString(),
        current: weatherValues(i => current.variables(i)?.value()),
        hourly: Array.from({ length }, (_, hour) => ({
          time: new Date((Number(hourly.time()) + hour * step) * 1000).toISOString(),
          ...weatherValues(i => arrays[i]?.[hour]),
        })),
      };
    });
  }));
  const samples = results.flat();
  const center = samples[0]!;
  // Map each target cell to the nearest point on our regular coarse sampling grid.
  const cells = target.cells.map(point => {
    const row = Math.min(coarse.rows - 1, Math.max(0, Math.round(
      (target.bounds.north - point.latitude) / (target.bounds.north - target.bounds.south) * coarse.rows - 0.5)));
    const column = Math.min(coarse.columns - 1, Math.max(0, Math.round(
      (point.longitude - target.bounds.west) / (target.bounds.east - target.bounds.west) * coarse.columns - 0.5)));
    return { ...point, sample_index: 1 + row * coarse.columns + column };
  });
  return {
    location: { latitude: lat, longitude: long },
    observation_time: center.observation_time,
    weather: center.current,
    terrain: { elevation_m: center.elevation_m },
    weather_grid: {
      source: "Open-Meteo", model, source_resolution_km: 3,
      bounds: target.bounds, rows: target.rows, columns: target.columns,
      resampling: "nearest", cells, samples,
    },
  };
}
