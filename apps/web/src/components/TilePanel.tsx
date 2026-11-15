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

  return (
    <>
      <dl className="tile-summary">
        <dt>Tile</dt>
        <dd>
          <code>{tile.tileId}</code>
        </dd>
        <dt>Cells</dt>
        <dd>{tile.cells.features.length.toLocaleString("en-US")}</dd>
        <dt>{historical ? "Peak (hindcast)" : "Peak fire probability"}</dt>
        <dd>{peak === null ? "no data" : percent(peak)}</dd>
        <dt>Extreme cells (≥ {percent(EXTREME_PROBABILITY)})</dt>
        <dd>{extreme}</dd>
        <dt>{historical ? "Detections that day" : "Satellite detections"}</dt>
        <dd>
          {ages.length}
          {newest !== null && !historical && ` (newest ${formatAge(newest)})`}
        </dd>
        {!historical && (
          <>
            <dt>Model output</dt>
            <dd>{tile.updatedAt ? formatAge(ageHours(tile.updatedAt, now)) : "unknown"}</dd>
          </>
        )}
      </dl>
      {historical ? <Perimeters tile={tile} /> : (
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
