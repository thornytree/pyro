import type { ModelInfo, TileResponse, WeatherDrivers } from "../api/types";
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
/** Real model probabilities sit in the low percents, where whole numbers hide the differences. */
const chance = (p: number) => (p < 0.1 ? `${(p * 100).toFixed(1)}%` : percent(p));
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
    const failed = tile.inference?.status === "failed" ? tile.inference : null;
    return (
      <>
        {failed ? (
          <p className="error">
            Model output is unavailable: {failed.message} Showing source data only.
          </p>
        ) : (
          <p>Source data loaded for the selected 300-square-mile region. Predictions are not available yet.</p>
        )}
        <p>Satellite detections: {tile.detections.features.length}</p>
        <SourceData tile={tile} />
        {failed && <button onClick={onRetry}>Try again</button>}
      </>
    );
  }

  const now = new Date();
  const reference = referenceTime(mode, now);
  const probabilities = tile.cells.features.map((f) => f.properties.probability);
  const peak = probabilities.length > 0 ? Math.max(...probabilities) : null;
  const model = tile.model ?? null;
  // Live model cells are ranked by score; mock and hindcast cells only have a probability.
  const extreme = tile.cells.features.filter(
    (f) => (f.properties.riskScore ?? f.properties.probability) >= EXTREME_PROBABILITY,
  ).length;
  const filled = tile.cells.features.filter((f) => f.properties.filled).length;
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
        <dd>
          {peak === null ? "no data" : chance(peak)}
          {peak !== null && model && model.baseRate > 0 &&
            ` (${(peak / model.baseRate).toFixed(1)}× the usual ${chance(model.baseRate)})`}
        </dd>
        {model && (
          <>
            <dt>Forecast day</dt>
            <dd>{model.predictionDate}</dd>
          </>
        )}
        <dt>
          {model ? "High-risk cells (score ≥ " : "Extreme cells (≥ "}{percent(EXTREME_PROBABILITY)})
        </dt>
        <dd>{extreme}</dd>
        {filled > 0 && (
          <>
            <dt>Cells filled from neighbours</dt>
            <dd>{filled.toLocaleString("en-US")}</dd>
          </>
        )}
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
        <Spread tile={tile} model={model} show={showSpread} onToggle={onToggleSpread} />
      )}
      {tile.bundle && (
        <section className="spread-summary">
          <h3>Source data</h3>
          <SourceData tile={tile} />
        </section>
      )}
    </>
  );
}

/** The live bundle behind a region: what was fetched, and a download of all of it. */
function SourceData({ tile }: { tile: TileResponse }) {
  const bundle = tile.bundle;
  if (!bundle) return null;
  return (
    <>
      <dl className="tile-summary">
        <dt>Selected point</dt>
        <dd>{bundle.location.latitude.toFixed(5)}, {bundle.location.longitude.toFixed(5)}</dd>
        <dt>Weather</dt>
        <dd>{bundle.weather.temperature.toFixed(1)} °C, {Math.round(bundle.weather.humidity)}% humidity</dd>
        <dt>Wind</dt>
        <dd>{bundle.weather.wind_speed_kph.toFixed(1)} km/h from {compassPoint(bundle.weather.wind_direction)}</dd>
        <dt>Elevation</dt>
        <dd>{bundle.terrain.elevation_m === null ? "no data" : `${Math.round(bundle.terrain.elevation_m)} m`}</dd>
        <dt>Regional grid</dt>
        <dd>{bundle.weather_grid.rows} × {bundle.weather_grid.columns} cells</dd>
        <dt>Historical weather context</dt>
        <dd>{bundle.historical_weather.start_date} to {bundle.historical_weather.end_date}</dd>
        <dt>Fuel map</dt>
        <dd>{bundle.vegetation.version}</dd>
      </dl>
      <button onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `${tile.tileId}-sources.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Download source data</button>
    </>
  );
}

/** Why a tile has no spread outlines. The mock predicts spread from extreme cells; the model from confirmed fire. */
function noSpreadReason(model: ModelInfo | null): string {
  if (model?.spread.status === "no_confirmed_fire") {
    return "The spread model starts from a confirmed fire, and this region has no nominal- or high-confidence detection in the last 24 hours. Open one under Active fires to see a prediction.";
  }
  if (model?.spread.status === "unavailable") {
    return "The spread model did not answer for this region. The probabilities are unaffected.";
  }
  return `No cell reaches ${percent(EXTREME_PROBABILITY)}, so no spread is predicted for this tile.`;
}

function Spread({
  tile,
  model,
  show,
  onToggle,
}: {
  tile: TileResponse;
  model: ModelInfo | null;
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
        <p className="hint">{noSpreadReason(model)}</p>
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
          {model?.spread.status === "ok" && (
            <p className="hint">
              From {model.spread.fire.detections} confirmed detection
              {model.spread.fire.detections === 1 ? "" : "s"}. Fires this size spread{" "}
              {model.spread.meanSpreadKmPerDay.toFixed(2)} km a day on average.
            </p>
          )}
          {tile.drivers && <Drivers drivers={tile.drivers} fromFire={model !== null} />}
        </>
      )}
    </section>
  );
}

function Drivers({ drivers, fromFire }: { drivers: WeatherDrivers; fromFire: boolean }) {
  const mph = kmToMiles(drivers.windSpeedKmh);
  const fahrenheit = drivers.temperatureC * 1.8 + 32;
  return (
    <p className="hint">
      From weather {formatAge(ageHours(drivers.observedAt, new Date()))}: wind{" "}
      {Math.round(mph)} mph from the {compassPoint(drivers.windFromDeg)}, humidity{" "}
      {Math.round(drivers.relativeHumidityPct)}%, {Math.round(fahrenheit)} °F (
      {Math.round(drivers.temperatureC)} °C). Distances are how far the head
      fire runs {fromFire ? "from the centre of the confirmed detections" : "past the downwind edge of the extreme-risk cells"}.
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
