import type { TileResponse, WeatherDrivers } from "../api/types";
import { ageHours, formatAge } from "../lib/age";
import { type MapMode, referenceTime } from "../lib/mode";
import { compassPoint, EXTREME_PROBABILITY, kmToMiles } from "../lib/spread";

export type Selection =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "outside" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; tile: TileResponse };

interface Props {
  selection: Selection;
  mode: MapMode;
  showSpread: boolean;
  onToggleSpread: (show: boolean) => void;
  onRetry: () => void;
}

export function TilePanel({ selection, mode, showSpread, onToggleSpread, onRetry }: Props) {
  switch (selection.kind) {
    case "idle":
      return <p>Click an area in the state to load its surrounding region.</p>;
    case "loading":
      return <p>Loading tile…</p>;
    case "outside":
      return <p>That point is outside the contiguous US, which is the supported area.</p>;
    case "error":
      return (
        <>
          <p className="error">Could not load the tile: {selection.message}</p>
          <button onClick={onRetry}>Try again</button>
        </>
      );
    case "loaded":
      return (
        <TileSummary
          tile={selection.tile}
          mode={mode}
          showSpread={showSpread}
          onToggleSpread={onToggleSpread}
          onRetry={onRetry}
        />
      );
  }
}

const percent = (p: number) => `${Math.round(p * 100)}%`;
const miles = (km: number) => `${kmToMiles(km).toFixed(1)} mi (${km.toFixed(1)} km)`;

function TileSummary({
  tile,
  mode,
  showSpread,
  onToggleSpread,
  onRetry,
}: Omit<Props, "selection"> & { tile: TileResponse }) {
  if (tile.status === "queued") {
    return (
      <>
        <p>
          Tile <code>{tile.tileId}</code> has been queued. Results appear after
          the next scheduled run.
        </p>
        <button onClick={onRetry}>Check again</button>
      </>
    );
  }

  if (tile.status === "observed") {
    return (
      <>
        <p>Source data loaded for the selected 300-square-mile region. Spread predictions are not available yet.</p>
        <p>Satellite detections: {tile.detections.features.length}</p>
        {tile.inference?.status === "unavailable" && <p className="hint">{tile.inference.message}</p>}
        <SourceFailures tile={tile} />
        {tile.bundle && (
          <>
            <dl className="tile-summary">
              <dt>Selected point</dt>
              <dd>{tile.bundle.location.latitude.toFixed(5)}, {tile.bundle.location.longitude.toFixed(5)}</dd>
              <dt>Weather</dt>
              <dd>{tile.bundle.weather.temperature.toFixed(1)} °C, {Math.round(tile.bundle.weather.humidity)}% humidity</dd>
              <dt>Wind</dt>
              <dd>{tile.bundle.weather.wind_speed_kph.toFixed(1)} km/h from {compassPoint(tile.bundle.weather.wind_direction)}</dd>
              <dt>Elevation</dt>
              <dd>{tile.bundle.terrain?.elevation_m == null ? "no data" : `${Math.round(tile.bundle.terrain.elevation_m)} m`}</dd>
              <dt>Regional grid</dt>
              <dd>{tile.bundle.weather_grid.rows} × {tile.bundle.weather_grid.columns} cells</dd>
              <dt>Historical weather context</dt>
              <dd>{tile.bundle.historical_weather ? `${tile.bundle.historical_weather.start_date} to ${tile.bundle.historical_weather.end_date}` : "no data"}</dd>
              <dt>Fuel map</dt>
              <dd>{tile.bundle.vegetation?.version ?? "no data"}</dd>
            </dl>
            <DownloadSources tile={tile} />
          </>
        )}
      </>
    );
  }

  const now = new Date();
  const reference = referenceTime(mode, now);
  const probabilities = tile.cells.features.map((f) => f.properties.probability);
  const peak = probabilities.length > 0 ? Math.max(...probabilities) : null;
  const extreme = probabilities.filter((p) => p >= EXTREME_PROBABILITY).length;
  const ages = tile.detections.features.map((f) => ageHours(f.properties.acquiredAt, reference));
  const newest = ages.length > 0 ? Math.min(...ages) : null;
  const historical = mode.kind === "historical";
  const sampleRelative = tile.prediction?.scoreKind === "sample_relative";

  return (
    <>
      {tile.history && <p className="hint">{tile.history.message} Retrospective weather reconstruction; not an archived forecast.</p>}
      {sampleRelative && (
        <p className="hint">
          Experimental {tile.prediction!.horizonHours}-hour fire-detection score.
          The model was trained on 10 km cells; finer map cells repeat those scores.
          Scores are relative to the sampled training data, not calibrated burn probabilities.
        </p>
      )}
      <SourceFailures tile={tile} />
      <dl className="tile-summary">
        <dt>Tile</dt>
        <dd>
          <code>{tile.tileId}</code>
        </dd>
        <dt>Cells</dt>
        <dd>{tile.cells.features.length.toLocaleString("en-US")}</dd>
        <dt>{historical ? "Peak (hindcast)" : sampleRelative ? "Peak daily detection score" : "Peak fire probability"}</dt>
        <dd>{peak === null ? "no data" : sampleRelative ? `${Math.round(peak * 100)}/100` : percent(peak)}</dd>
        <dt>{sampleRelative ? "High-score cells" : "Extreme cells"} (≥ {sampleRelative ? "80/100" : percent(EXTREME_PROBABILITY)})</dt>
        <dd>{extreme}</dd>
        <dt>{historical ? "Detections that day" : "Satellite detections"}</dt>
        <dd>
          {tile.history ? tile.history.observedDetectionCount : tile.bundle?.fire === null ? "unavailable" : ages.length}
          {newest !== null && !historical && ` (newest ${formatAge(newest)})`}
        </dd>
        {!historical && (
          <>
            <dt>Model output</dt>
            <dd>{tile.updatedAt ? formatAge(ageHours(tile.updatedAt, now)) : "unknown"}</dd>
          </>
        )}
      </dl>
      <DownloadSources tile={tile} />
      {sampleRelative ? (
        <p className="hint">No spread direction, speed or future perimeter is predicted by this baseline.</p>
      ) : historical ? <Perimeters tile={tile} /> : (
        <Spread tile={tile} show={showSpread} onToggle={onToggleSpread} />
      )}
    </>
  );
}

function Spread({
  tile,
  show,
  onToggle,
}: {
  tile: TileResponse;
  show: boolean;
  onToggle: (show: boolean) => void;
}) {
  const zones = [...(tile.spread?.features ?? [])].sort(
    (a, b) => a.properties.horizonHours - b.properties.horizonHours,
  );
  const first = zones[0]?.properties;
  return (
    <section className="spread-summary">
      <h3>
        Predicted spread <span className="badge experimental">experimental</span>
      </h3>
      {!first ? (
        <p className="hint">
          No cell reaches {percent(EXTREME_PROBABILITY)}, so no spread is predicted for this tile.
        </p>
      ) : (
        <>
          <label className="toggle">
            <input type="checkbox" checked={show} onChange={(e) => onToggle(e.target.checked)} />
            Show on map
          </label>
          <p>
            Heading <strong>{compassPoint(first.headingDeg)}</strong> at{" "}
            {kmToMiles(first.rateKmh).toFixed(2)} mi/h ({first.rateKmh.toFixed(2)} km/h).
          </p>
          <dl>
            {zones.map(({ properties: z }) => (
              <FragmentRow
                key={z.horizonHours}
                term={`In ${z.horizonHours} h`}
                value={`${miles(z.headKm)}, ${percent(z.confidence)} conf.`}
              />
            ))}
          </dl>
          {tile.drivers && <Drivers drivers={tile.drivers} />}
        </>
      )}
    </section>
  );
}

function Drivers({ drivers }: { drivers: WeatherDrivers }) {
  const mph = kmToMiles(drivers.windSpeedKmh);
  const fahrenheit = drivers.temperatureC * 1.8 + 32;
  return (
    <p className="hint">
      From weather {formatAge(ageHours(drivers.observedAt, new Date()))}: wind{" "}
      {Math.round(mph)} mph from the {compassPoint(drivers.windFromDeg)}, humidity{" "}
      {Math.round(drivers.relativeHumidityPct)}%, {Math.round(fahrenheit)} °F (
      {Math.round(drivers.temperatureC)} °C). Distances are how far the head
      fire runs past the downwind edge of the extreme-risk cells.
    </p>
  );
}

function Perimeters({ tile }: { tile: TileResponse }) {
  const perimeters = tile.perimeters?.features ?? [];
  return (
    <section className="spread-summary">
      <h3>Observed perimeters</h3>
      {perimeters.length === 0 ? (
        <p className="hint">
          No mapped perimeter for this tile on this day. Perimeter data covers
          the western US from 2020 to 2024.
        </p>
      ) : (
        <dl>
          {perimeters.map(({ properties: p }, i) => (
            <FragmentRow
              key={`${p.fireName}-${i}`}
              term={p.fireName}
              value={`${(p.areaKm2 * 247.105).toLocaleString("en-US", { maximumFractionDigits: 0 })} acres`}
            />
          ))}
        </dl>
      )}
    </section>
  );
}

function FragmentRow({ term, value }: { term: string; value: string }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{value}</dd>
    </>
  );
}


/** Names the context sources whose provider failed, so missing data is not read as "none". */
function SourceFailures({ tile }: { tile: TileResponse }) {
  const failures = tile.bundle?.source_failures ?? [];
  if (failures.length === 0) return null;
  return (
    <p className="hint">
      Unavailable right now: {failures.map((failure) => failure.source).join(", ")}.
      {tile.bundle?.fire === null && " Satellite detections are not shown."}
    </p>
  );
}

function DownloadSources({ tile }: { tile: TileResponse }) {
  if (!tile.bundle) return null;
  return <button onClick={() => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(tile.bundle, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${tile.tileId}-sources.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }}>Download source data</button>;
}
