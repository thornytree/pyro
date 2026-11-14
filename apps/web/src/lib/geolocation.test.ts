import { describe, expect, it } from "vitest";
import { locate } from "./geolocation";

const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;

function fakeGeolocation(
  outcome: { coords: { latitude: number; longitude: number } } | { code: number; message: string },
): Geolocation {
  return {
    getCurrentPosition: (onSuccess, onError) => {
      if ("coords" in outcome) onSuccess(outcome as GeolocationPosition);
      else onError?.({ ...outcome, PERMISSION_DENIED, POSITION_UNAVAILABLE, TIMEOUT: 3 } as GeolocationPositionError);
    },
    watchPosition: () => 0,
    clearWatch: () => undefined,
  };
}

describe("locate", () => {
  it("returns the position on approval", async () => {
    const result = await locate(fakeGeolocation({ coords: { latitude: 39.7, longitude: -105 } }));
    expect(result).toEqual({ kind: "located", point: { lat: 39.7, long: -105 } });
  });
  it("reports a declined prompt", async () => {
    const result = await locate(fakeGeolocation({ code: PERMISSION_DENIED, message: "" }));
    expect(result).toEqual({ kind: "denied" });
  });
  it("reports other failures", async () => {
    const result = await locate(fakeGeolocation({ code: POSITION_UNAVAILABLE, message: "no fix" }));
    expect(result).toEqual({ kind: "unavailable", message: "no fix" });
  });
  it("handles browsers without geolocation", async () => {
    expect((await locate(null)).kind).toBe("unavailable");
  });
});
