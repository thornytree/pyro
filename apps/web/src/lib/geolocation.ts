import type { LatLong } from "../api/types";

export type LocateResult =
  | { kind: "located"; point: LatLong }
  | { kind: "denied" }
  | { kind: "unavailable"; message: string };

/** Asks the browser for the user's position. Never rejects. */
export function locate(
  geolocation: Geolocation | null = globalThis.navigator?.geolocation ?? null,
): Promise<LocateResult> {
  if (!geolocation) {
    return Promise.resolve({
      kind: "unavailable",
      message: "this browser does not support location",
    });
  }
  return new Promise((resolve) => {
    geolocation.getCurrentPosition(
      (position) =>
        resolve({
          kind: "located",
          point: { lat: position.coords.latitude, long: position.coords.longitude },
        }),
      (error) =>
        resolve(
          error.code === error.PERMISSION_DENIED
            ? { kind: "denied" }
            : { kind: "unavailable", message: error.message || "position unavailable" },
        ),
      // State-level precision is enough; a cached fix avoids a slow GPS wait.
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60_000 },
    );
  });
}
