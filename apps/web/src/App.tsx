import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStateHeatmapFetcher, createTileFetcher } from "./api/client";
import { createMockStateHeatmapFetcher, mockTileFetcher } from "./api/mock";
import type { LatLong } from "./api/types";
import { Legend, type LegendOverlay } from "./components/Legend";
import { ModeSwitch } from "./components/ModeSwitch";
import { StatePanel, type HeatmapSelection } from "./components/StatePanel";
import { TilePanel, type Selection } from "./components/TilePanel";
import { availableViews, ViewSwitch } from "./components/ViewSwitch";
import type { AppConfig } from "./config";
import { isInConusBounds } from "./lib/conus";
import { locate } from "./lib/geolocation";
import { type MapMode, modeFromSearch, modeLabel, modeToSearch, sameMode } from "./lib/mode";
import { conusStates, stateAt, type StateFeature } from "./lib/states";
import type { MapViewKind } from "./map/MapView";

// MapLibre is most of the bundle. Loading it separately lets the panel paint first.
const MapView = lazy(() => import("./map/MapView").then((module) => ({ default: module.MapView })));

type HistoryExample = { date: string; lat: number; long: number };

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
  const fetchHeatmap = useMemo(
    () =>
      config.useMock
        ? createMockStateHeatmapFetcher((fips) =>
            states.find((s) => s.properties.fips === fips),
          )
        : createStateHeatmapFetcher(config.orchestratorUrl),
    [config, states],
  );
  const views = useMemo(
    () => availableViews(config.terrain !== null, config.satellite !== null),
    [config],
  );

  const [mode, setMode] = useState<MapMode>(() =>
    modeFromSearch(window.location.search, new Date()),
  );
  const [showSpread, setShowSpread] = useState(true);
  const [state, setState] = useState<StateFeature | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapSelection>({ kind: "loading" });
  const [view, setView] = useState<MapViewKind>("heat");
  const [selection, setSelection] = useState<Selection>({ kind: "idle" });
  const [userLocation, setUserLocation] = useState<LatLong | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>({ kind: "idle" });
  const lastPoint = useRef<LatLong | null>(null);
  // Request callbacks read the mode through a ref so a switch can reload at once.
  const modeRef = useRef(mode);
  const openFips = useRef<string | null>(null);
  const tileRequest = useRef<AbortController | null>(null);
  const heatmapRequest = useRef<AbortController | null>(null);
  const nextExample = useRef(0);
  const examples = useRef<Promise<HistoryExample[]> | null>(null);

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
        const tile = await fetchTile(point, modeRef.current, controller.signal);
        if (!controller.signal.aborted) setSelection({ kind: "loaded", tile });
      } catch (error) {
        if (controller.signal.aborted) return;
        setSelection({ kind: "error", message: errorMessage(error) });
      }
    },
    [fetchTile],
  );

  const loadHeatmap = useCallback(
    async (fips: string) => {
      heatmapRequest.current?.abort();
      const controller = new AbortController();
      heatmapRequest.current = controller;
      setHeatmap({ kind: "loading" });
      try {
        const result = await fetchHeatmap(fips, modeRef.current, controller.signal);
        if (!controller.signal.aborted) setHeatmap({ kind: "loaded", heatmap: result });
      } catch (error) {
        if (controller.signal.aborted) return;
        setHeatmap({ kind: "error", message: errorMessage(error) });
      }
    },
    [fetchHeatmap],
  );

  const openState = useCallback(
    async (fips: string | null) => {
      tileRequest.current?.abort();
      heatmapRequest.current?.abort();
      lastPoint.current = null;
      setSelection({ kind: "idle" });
      const next = fips === null ? null : (states.find((s) => s.properties.fips === fips) ?? null);
      openFips.current = next?.properties.fips ?? null;
      setState(next);
      if (next) await loadHeatmap(next.properties.fips);
    },
    [loadHeatmap, states],
  );

  /**
   * Switches between live and historical (or to another day). The open state
   * and tile stay open and reload in the new mode, so the same place can be
   * compared across modes. The mode is kept in the URL for sharing.
   */
  const changeMode = useCallback(
    (requested: MapMode) => {
      const next = requested;
      if (sameMode(next, modeRef.current)) return;
      modeRef.current = next;
      setMode(next);
      const { pathname, hash, search } = window.location;
      window.history.replaceState(null, "", `${pathname}${modeToSearch(next, search)}${hash}`);
      if (openFips.current) void loadHeatmap(openFips.current);
      if (lastPoint.current) void select(lastPoint.current);
    },
    [loadHeatmap, select],
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

  /** Opens the next archived example; the list is fetched once and reused. */
  const openExample = useCallback(async () => {
    try {
      examples.current ??= fetch(`${config.orchestratorUrl}/history/examples`).then(async (response) => {
        if (!response.ok) throw new Error("Historical archive is unavailable");
        const data = await response.json();
        return Array.isArray(data.examples) ? (data.examples as HistoryExample[]) : [];
      });
      const list = await examples.current;
      if (list.length === 0) throw new Error("No historical examples are available");
      // Each click opens the next example, wrapping at the end of the list.
      const example = list[nextExample.current % list.length] as HistoryExample;
      nextExample.current = (nextExample.current + 1) % list.length;
      const home = stateAt(states, example.lat, example.long);
      if (!home) throw new Error("Historical example is outside the map coverage");
      // The mode comes first so the state opens once, already in historical mode.
      changeMode({ kind: "historical", date: example.date });
      await openState(home.properties.fips);
      await select({ lat: example.lat, long: example.long });
    } catch (error) {
      examples.current = null; // A failed fetch is retried on the next click.
      setSelection({ kind: "error", message: errorMessage(error) });
    }
  }, [changeMode, config.orchestratorUrl, openState, select, states]);

  const tile = selection.kind === "loaded" ? selection.tile : null;
  const stateHeatmap = state && heatmap.kind === "loaded" ? heatmap.heatmap : null;
  const terrainShown = config.terrain !== null && (view === "terrain" || (view === "heat" && tile !== null));
  const historical = mode.kind === "historical";
  const overlay: LegendOverlay =
    tile === null
      ? null
      : historical
        ? (tile.perimeters?.features.length ?? 0) > 0
          ? "perimeters"
          : null
        : showSpread && (tile.spread?.features.length ?? 0) > 0
          ? "spread"
          : null;

  return (
    <div className="app" data-mode={mode.kind}>
      <Suspense fallback={<div className="map map-loading">Loading map…</div>}>
        <MapView
          styleUrl={config.mapStyleUrl}
          terrain={config.terrain}
          satellite={config.satellite}
          view={view}
          states={states}
          selectedState={state}
          heatmap={stateHeatmap}
          tile={tile}
          mode={mode}
          showSpread={showSpread}
          userLocation={userLocation}
          onSelectState={(fips) => void openState(fips)}
          onClearState={() => void openState(null)}
          onSelectPoint={(point) => void select(point)}
        />
      </Suspense>
      <ViewSwitch views={views} view={view} onChange={setView} />
      {state && (
        <button className="map-return" onClick={() => void openState(null)}>
          ← US map
        </button>
      )}
      <div className={`mode-banner ${mode.kind}`} role="status">
        {config.useMock || historical ? modeLabel(mode) : (tile ?? stateHeatmap)?.prediction ? "Experimental daily fire score" : "Live observations"}
      </div>
      <aside className="panel">
        <h1>
          Pyro {config.useMock && <span className="badge">mock data</span>}
        </h1>
        <ModeSwitch mode={mode} now={new Date()} onChange={changeMode} historyAvailable={true} />
        {!config.useMock && (
          <button onClick={() => void openExample()}>Open archived fire-detection example</button>
        )}
        {!state && selection.kind === "error" && <p className="error">{selection.message}</p>}
        {state ? (
          <>
            <StatePanel
              state={state}
              heatmap={heatmap}
              onBack={() => void openState(null)}
              onRetry={() => void openState(state.properties.fips)}
              onJumpTo={(point) => void select(point)}
            />
            {selection.kind !== "idle" && (
              <TilePanel
                selection={selection}
                mode={mode}
                showSpread={showSpread}
                onToggleSpread={setShowSpread}
                onRetry={retryTile}
              />
            )}
          </>
        ) : (
          <p>
            Hover over a state to highlight it, then click or zoom in to open its fire
            heat map.
          </p>
        )}
        <LocationControl status={locationStatus} onLocate={() => void locateUser(false)} />
        <Legend
          terrain={terrainShown}
          overlay={overlay}
          historical={historical}
          generated={config.useMock}
          relativeScore={(tile ?? stateHeatmap)?.prediction?.scoreKind === "sample_relative"}
        />
        <footer>
          Data: NASA FIRMS (fire detections), Open-Meteo (weather), LANDFIRE
          (fuels and vegetation), USGS 3DEP (terrain). State outlines: US Census Bureau.
          {historical && config.useMock && " Perimeters: Mendeley daily perimeter dataset (CC BY 4.0)."}
          {config.terrain && <> {config.terrain.attribution}.</>}
          {config.satellite && <> {config.satellite.attribution}.</>}
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
