import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStatePreviewFetcher, createTileFetcher } from "./api/client";
import { createMockStatePreviewFetcher, mockTileFetcher } from "./api/mock";
import type { LatLong } from "./api/types";
import { Legend } from "./components/Legend";
import { StatePanel, type PreviewSelection } from "./components/StatePanel";
import { TilePanel, type Selection } from "./components/TilePanel";
import type { AppConfig } from "./config";
import { isInConusBounds } from "./lib/conus";
import { locate } from "./lib/geolocation";
import { conusStates, stateAt, type StateFeature } from "./lib/states";
import { MapView } from "./map/MapView";

type LocationStatus =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "located"; name: string }
  | { kind: "outside" }
  | { kind: "denied" }
  | { kind: "unavailable"; message: string };

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "unknown error";

export function App({ config }: { config: AppConfig }) {
  const states = useMemo(() => conusStates(), []);
  const fetchTile = useMemo(
    () => (config.useMock ? mockTileFetcher : createTileFetcher(config.orchestratorUrl)),
    [config],
  );
  const fetchPreview = useMemo(
    () =>
      config.useMock
        ? createMockStatePreviewFetcher((fips) =>
            states.find((s) => s.properties.fips === fips),
          )
        : createStatePreviewFetcher(config.orchestratorUrl),
    [config, states],
  );

  const [state, setState] = useState<StateFeature | null>(null);
  const [preview, setPreview] = useState<PreviewSelection>({ kind: "loading" });
  const [selection, setSelection] = useState<Selection>({ kind: "idle" });
  const [userLocation, setUserLocation] = useState<LatLong | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>({ kind: "idle" });
  const lastPoint = useRef<LatLong | null>(null);
  const openFips = useRef<string | null>(null);
  const tileRequest = useRef<AbortController | null>(null);
  const previewRequest = useRef<AbortController | null>(null);

  const select = useCallback(
    async (point: LatLong) => {
      // A newer click supersedes any request still in flight.
      tileRequest.current?.abort();
      lastPoint.current = point;
      if (!isInConusBounds(point.lat, point.long)) {
        setSelection({ kind: "outside" });
        return;
      }
      const controller = new AbortController();
      tileRequest.current = controller;
      setSelection({ kind: "loading" });
      try {
        const tile = await fetchTile(point, controller.signal);
        if (!controller.signal.aborted) setSelection({ kind: "loaded", tile });
      } catch (error) {
        if (controller.signal.aborted) return;
        setSelection({ kind: "error", message: errorMessage(error) });
      }
    },
    [fetchTile],
  );

  const openState = useCallback(
    async (fips: string | null) => {
      tileRequest.current?.abort();
      previewRequest.current?.abort();
      lastPoint.current = null;
      setSelection({ kind: "idle" });
      const next = fips === null ? null : (states.find((s) => s.properties.fips === fips) ?? null);
      openFips.current = next?.properties.fips ?? null;
      setState(next);
      if (!next) return;

      const controller = new AbortController();
      previewRequest.current = controller;
      setPreview({ kind: "loading" });
      try {
        const result = await fetchPreview(next.properties.fips, controller.signal);
        if (!controller.signal.aborted) setPreview({ kind: "loaded", preview: result });
      } catch (error) {
        if (controller.signal.aborted) return;
        setPreview({ kind: "error", message: errorMessage(error) });
      }
    },
    [fetchPreview, states],
  );

  /**
   * Finds the user and opens their state. `onlyIfIdle` leaves the view alone if
   * the user already opened a state while the browser was asking for permission.
   */
  const locateUser = useCallback(
    async (onlyIfIdle: boolean) => {
      setLocationStatus({ kind: "locating" });
      const result = await locate();
      if (result.kind !== "located") {
        setLocationStatus(result);
        return;
      }
      const { lat, long } = result.point;
      const home = stateAt(states, lat, long);
      setUserLocation(result.point);
      if (!home) {
        setLocationStatus({ kind: "outside" });
        return;
      }
      setLocationStatus({ kind: "located", name: home.properties.name });
      if (onlyIfIdle && openFips.current !== null) return;
      void openState(home.properties.fips);
    },
    [openState, states],
  );

  // Ask once on load; StrictMode runs effects twice in development.
  const askedOnLoad = useRef(false);
  useEffect(() => {
    if (askedOnLoad.current) return;
    askedOnLoad.current = true;
    void locateUser(true);
  }, [locateUser]);

  const retryTile = useCallback(() => {
    if (lastPoint.current) void select(lastPoint.current);
  }, [select]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void openState(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openState]);

  const tile = selection.kind === "loaded" ? selection.tile : null;

  return (
    <div className="app">
      <MapView
        styleUrl={config.mapStyleUrl}
        terrain={config.terrain}
        states={states}
        selectedState={state}
        preview={state && preview.kind === "loaded" ? preview.preview : null}
        tile={tile}
        userLocation={userLocation}
        onSelectState={(fips) => void openState(fips)}
        onClearState={() => void openState(null)}
        onSelectPoint={(point) => void select(point)}
      />
      {state && (
        <button className="map-return" onClick={() => void openState(null)}>
          ← US map
        </button>
      )}
      <aside className="panel">
        <h1>
          Pyro {config.useMock && <span className="badge">mock data</span>}
        </h1>
        {state ? (
          <>
            <StatePanel
              name={state.properties.name}
              preview={preview}
              onBack={() => void openState(null)}
              onRetry={() => void openState(state.properties.fips)}
              onJumpTo={(point) => void select(point)}
            />
            {selection.kind !== "idle" && (
              <TilePanel selection={selection} onRetry={retryTile} />
            )}
          </>
        ) : (
          <p>
            Hover over a state to highlight it, then click or zoom in to open its fire
            preview.
          </p>
        )}
        <LocationControl status={locationStatus} onLocate={() => void locateUser(false)} />
        <Legend terrain={tile !== null && config.terrain !== null} />
        <footer>
          Data: NASA FIRMS (fire detections), Open-Meteo (weather), LANDFIRE
          (fuels and terrain). State outlines: US Census Bureau.
          {config.terrain && <> {config.terrain.attribution}.</>}
        </footer>
      </aside>
    </div>
  );
}

function LocationControl({
  status,
  onLocate,
}: {
  status: LocationStatus;
  onLocate: () => void;
}) {
  const message = (() => {
    switch (status.kind) {
      case "idle":
        return null;
      case "locating":
        return "Finding your location…";
      case "located":
        return `You are in ${status.name}.`;
      case "outside":
        return "Your location is outside the contiguous US, which is the supported area.";
      case "denied":
        return "Location access was declined. Allow it in your browser settings to jump to your state.";
      case "unavailable":
        return `Could not get your location: ${status.message}`;
    }
  })();
  return (
    <div className="location">
      {message && <p className="hint">{message}</p>}
      <button onClick={onLocate} disabled={status.kind === "locating"}>
        Use my location
      </button>
    </div>
  );
}
