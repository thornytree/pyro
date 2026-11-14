import { useCallback, useMemo, useRef, useState } from "react";
import { createTileFetcher } from "./api/client";
import { mockTileFetcher } from "./api/mock";
import type { LatLong } from "./api/types";
import { Legend } from "./components/Legend";
import { TilePanel, type Selection } from "./components/TilePanel";
import type { AppConfig } from "./config";
import { isInConusBounds } from "./lib/conus";
import { MapView } from "./map/MapView";

export function App({ config }: { config: AppConfig }) {
  const fetchTile = useMemo(
    () => (config.useMock ? mockTileFetcher : createTileFetcher(config.orchestratorUrl)),
    [config],
  );
  const [selection, setSelection] = useState<Selection>({ kind: "idle" });
  const lastPoint = useRef<LatLong | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const select = useCallback(
    async (point: LatLong) => {
      // A newer click supersedes any request still in flight.
      inFlight.current?.abort();
      lastPoint.current = point;
      if (!isInConusBounds(point.lat, point.long)) {
        setSelection({ kind: "outside" });
        return;
      }
      const controller = new AbortController();
      inFlight.current = controller;
      setSelection({ kind: "loading" });
      try {
        const tile = await fetchTile(point, controller.signal);
        if (!controller.signal.aborted) setSelection({ kind: "loaded", tile });
      } catch (error) {
        if (controller.signal.aborted) return;
        setSelection({
          kind: "error",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
    },
    [fetchTile],
  );

  const retry = useCallback(() => {
    if (lastPoint.current) void select(lastPoint.current);
  }, [select]);

  const tile = selection.kind === "loaded" ? selection.tile : null;

  return (
    <div className="app">
      <MapView styleUrl={config.mapStyleUrl} tile={tile} onSelect={select} />
      <aside className="panel">
        <h1>
          Pyro {config.useMock && <span className="badge">mock data</span>}
        </h1>
        <TilePanel selection={selection} onRetry={retry} />
        <Legend />
        <footer>
          Data: NASA FIRMS (fire detections), Open-Meteo (weather), LANDFIRE
          (fuels and terrain).
        </footer>
      </aside>
    </div>
  );
}
