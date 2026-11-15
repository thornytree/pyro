import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createActiveFireFetcher, createStatePreviewFetcher, createTileFetcher } from "./api/client";
import { createMockStatePreviewFetcher, mockTileFetcher } from "./api/mock";
import type { ActiveFire, LatLong } from "./api/types";
import { ActiveFires, type FireList } from "./components/ActiveFires";
import { Legend, type LegendOverlay } from "./components/Legend";
import { ModeSwitch } from "./components/ModeSwitch";
import { StatePanel, type PreviewSelection } from "./components/StatePanel";
import { TilePanel, type Selection } from "./components/TilePanel";
import type { AppConfig } from "./config";
import { isInConusBounds } from "./lib/conus";
import type { Bounds } from "./lib/geo";
import { locate } from "./lib/geolocation";
import { type MapMode, modeFromSearch, modeLabel, modeToSearch, sameMode, supportedMode } from "./lib/mode";
import { regionBounds, snapToRegion } from "./lib/region";
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

  const [mode, setMode] = useState<MapMode>(() =>
    supportedMode(modeFromSearch(window.location.search, new Date()), config.useMock),
  );
  const [showSpread, setShowSpread] = useState(true);
  const [state, setState] = useState<StateFeature | null>(null);
  const [preview, setPreview] = useState<PreviewSelection>({ kind: "loading" });
  const [selection, setSelection] = useState<Selection>({ kind: "idle" });
  const [selectedBounds, setSelectedBounds] = useState<Bounds | null>(null);
  const [userLocation, setUserLocation] = useState<LatLong | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>({ kind: "idle" });
  const lastPoint = useRef<LatLong | null>(null);
  // Request callbacks read the mode through a ref so a switch can reload at once.
  const modeRef = useRef(mode);
  const openFips = useRef<string | null>(null);
  const tileRequest = useRef<AbortController | null>(null);
  const previewRequest = useRef<AbortController | null>(null);

  /**
   * Loads the region around a point. Live clicks snap to the region grid, so
   * the tile outlined under the cursor is the one that loads; `exact` centres
   * the region on the point instead.
   */
  const select = useCallback(
    async (clicked: LatLong, exact = false) => {
      // A newer click supersedes any request still in flight.
      tileRequest.current?.abort();
      const live = !config.useMock;
      const point = live && !exact ? snapToRegion(clicked) : clicked;
      lastPoint.current = point;
      if (!isInConusBounds(point.lat, point.long)) {
        setSelectedBounds(null);
        setSelection({ kind: "outside" });
        return;
      }
      // Mock tiles come from a fixed 50 km grid; their box is known once loaded.
      setSelectedBounds(live ? regionBounds(point) : null);
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
    [fetchTile, config.useMock],
  );

  const loadPreview = useCallback(
    async (fips: string) => {
      previewRequest.current?.abort();
      const controller = new AbortController();
      previewRequest.current = controller;
      setPreview({ kind: "loading" });
      try {
        const result = await fetchPreview(fips, modeRef.current, controller.signal);
        if (!controller.signal.aborted) setPreview({ kind: "loaded", preview: result });
      } catch (error) {
        if (controller.signal.aborted) return;
        setPreview({ kind: "error", message: errorMessage(error) });
      }
    },
    [fetchPreview],
  );

  const openState = useCallback(
    async (fips: string | null) => {
      tileRequest.current?.abort();
      previewRequest.current?.abort();
      lastPoint.current = null;
      setSelectedBounds(null);
      setSelection({ kind: "idle" });
      const next = fips === null ? null : (states.find((s) => s.properties.fips === fips) ?? null);
      openFips.current = next?.properties.fips ?? null;
      setState(next);
      if (next) await loadPreview(next.properties.fips);
    },
    [loadPreview, states],
  );

  /**
   * Switches between live and historical (or to another day). The open state
   * and tile stay open and reload in the new mode, so the same place can be
   * compared across modes. The mode is kept in the URL for sharing.
   */
  const changeMode = useCallback(
    (requested: MapMode) => {
      const next = supportedMode(requested, config.useMock);
      if (sameMode(next, modeRef.current)) return;
      modeRef.current = next;
      setMode(next);
      const { pathname, hash, search } = window.location;
      window.history.replaceState(null, "", `${pathname}${modeToSearch(next, search)}${hash}`);
      if (openFips.current) void loadPreview(openFips.current);
      if (lastPoint.current) void select(lastPoint.current, true);
    },
    [loadPreview, select, config.useMock],
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

  useEffect(() => {
    if (!config.useMock) {
      const { pathname, search, hash } = window.location;
      window.history.replaceState(null, "", `${pathname}${modeToSearch({ kind: "live" }, search)}${hash}`);
    }
  }, [config.useMock]);

  // Confirmed fires, the places with a spread prediction to show (live only).
  const [fires, setFires] = useState<FireList>({ kind: "loading" });
  const [fireAttempt, setFireAttempt] = useState(0);
  useEffect(() => {
    if (config.useMock) return;
    const controller = new AbortController();
    setFires({ kind: "loading" });
    createActiveFireFetcher(config.orchestratorUrl)(controller.signal)
      .then((found) => {
        if (controller.signal.aborted) return;
        setFires({
          kind: "loaded",
          // Fires over the border or offshore have no state to open.
          fires: found.flatMap((fire) => {
            const home = stateAt(states, fire.latitude, fire.longitude);
            return home ? [{ ...fire, stateName: home.properties.name }] : [];
          }),
        });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setFires({ kind: "error", message: errorMessage(error) });
      });
    return () => controller.abort();
  }, [config, states, fireAttempt]);

  /** Opens the fire's state and the region centred on the fire. */
  const openFire = useCallback(
    (fire: ActiveFire) => {
      const home = stateAt(states, fire.latitude, fire.longitude);
      if (!home) return;
      void openState(home.properties.fips);
      void select({ lat: fire.latitude, long: fire.longitude }, true);
    },
    [openState, select, states],
  );

  const retryTile = useCallback(() => {
    if (lastPoint.current) void select(lastPoint.current, true);
  }, [select]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void openState(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openState]);

  const tile = selection.kind === "loaded" ? selection.tile : null;
  const historical = mode.kind === "historical";
  const modelled = tile?.model != null;
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
      <MapView
        styleUrl={config.mapStyleUrl}
        terrain={config.terrain}
        states={states}
        selectedState={state}
        preview={state && preview.kind === "loaded" ? preview.preview : null}
        tile={tile}
        selectedBounds={selection.kind === "idle" ? null : selectedBounds}
        tileLoading={selection.kind === "loading"}
        snapToGrid={!config.useMock}
        mode={mode}
        showSpread={showSpread}
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
      <div className={`mode-banner ${mode.kind}`} role="status">
        {config.useMock || modelled ? modeLabel(mode) : "Live observations"}
      </div>
      <aside className="panel">
        <h1>
          Pyro {config.useMock && <span className="badge">mock data</span>}
        </h1>
        <ModeSwitch mode={mode} now={new Date()} onChange={changeMode} historyAvailable={config.useMock} />
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
            preview.
          </p>
        )}
        {!config.useMock && (
          <ActiveFires list={fires} onOpen={openFire} onRetry={() => setFireAttempt((n) => n + 1)} />
        )}
        <LocationControl status={locationStatus} onLocate={() => void locateUser(false)} />
        <Legend
          terrain={tile !== null && config.terrain !== null}
          overlay={overlay}
          historical={historical}
          relative={modelled}
        />
        <footer>
          Data: NASA FIRMS (fire detections), Open-Meteo (weather), LANDFIRE
          (fuels and vegetation), USGS 3DEP (terrain). State outlines: US Census Bureau.
          {historical && " Perimeters: Mendeley daily perimeter dataset (CC BY 4.0)."}
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
