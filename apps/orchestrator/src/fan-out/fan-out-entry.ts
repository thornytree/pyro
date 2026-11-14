import { getWeatherAttributes } from "./meteo.ts";
import { getFireAttributes } from "./firms.ts";

// FIRMS searches a 300-square-mile box centered on the selected point.
export async function fanOutEntry(lat: number, long: number) {
  const [weatherResult, fireResult] = await Promise.all([
    getWeatherAttributes(lat, long),
    getFireAttributes(lat, long),
  ]);

  return {
    ...weatherResult,
    ...fireResult,
    location: { latitude: lat, longitude: long },
  };
}
