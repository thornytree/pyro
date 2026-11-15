import { getWeatherAttributes } from "./meteo.ts";
import getFireAttributes from "./firms.ts";
import { getDaymetAttributes } from "./daymet.ts";
import { getTerrainAttributes } from "./terrain.ts";
import { getVegetationAttributes } from "./landfire.ts";
import { fetchSource, SourceFetchError } from "./source-error.ts";
import type { dataBundle, LandfireVersion, SourceFailure } from "./types.ts";

export type FanOutOptions = {
  forecastHours?: number;
  landfireVersion?: LandfireVersion;
  daymet: { startDate: string; endDate: string };
};

// All five sources cover the same centered 300-square-mile region.
// Open-Meteo defines the grid and feeds the model, so its failure rejects.
// The other four are context: a failure leaves that field null and is reported
// in source_failures instead of failing the whole region.
export async function fanOutEntry(
  lat: number,
  long: number,
  options: FanOutOptions,
): Promise<dataBundle> {
  const failures: SourceFailure[] = [];
  const optional = async <T>(source: SourceFailure["source"], fetcher: () => Promise<T>): Promise<T | null> => {
    try { return await fetchSource(source, fetcher); }
    catch (error) {
      if (!(error instanceof SourceFetchError)) throw error;
      console.error(error.message); // Constructed, credential-free diagnostic.
      failures.push({
        source, reason: error.reason, message: error.message,
        ...(error.upstreamStatus === undefined ? {} : { upstreamStatus: error.upstreamStatus }),
      });
      return null;
    }
  };
  const [weatherResult, fireResult, daymetResult, terrainResult, vegetationResult] = await Promise.all([
    fetchSource("Open-Meteo", () => getWeatherAttributes(lat, long, { forecastHours: options.forecastHours })),
    optional("FIRMS", () => getFireAttributes(lat, long)),
    optional("Daymet", () => getDaymetAttributes(lat, long, options.daymet.startDate, options.daymet.endDate)),
    optional("USGS 3DEP", () => getTerrainAttributes(lat, long)),
    optional("LANDFIRE", () => getVegetationAttributes(lat, long, { version: options.landfireVersion })),
  ]);

  const bundle: dataBundle = {
    location: { latitude: lat, longitude: long },
    observation_time: weatherResult.observation_time,
    weather: weatherResult.weather,
    weather_grid: weatherResult.weather_grid,
    fire: fireResult?.fire ?? null,
    historical_weather: daymetResult?.historical_weather ?? null,
    terrain: terrainResult?.terrain ?? null,
    vegetation: vegetationResult?.vegetation ?? null,
    source_failures: failures,
  };
  return bundle;
}
