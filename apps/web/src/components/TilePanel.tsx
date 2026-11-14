import type { TileResponse } from "../api/types";
import { ageHours, formatAge } from "../lib/age";

export type Selection =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "outside" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; tile: TileResponse };

interface Props {
  selection: Selection;
  onRetry: () => void;
}

export function TilePanel({ selection, onRetry }: Props) {
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
      return <TileSummary tile={selection.tile} onRetry={onRetry} />;
  }
}

function TileSummary({ tile, onRetry }: { tile: TileResponse; onRetry: () => void }) {
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
  const probabilities = tile.cells.features.map((f) => f.properties.probability);
  const peak = probabilities.length > 0 ? Math.max(...probabilities) : null;
  const ages = tile.detections.features.map((f) =>
    ageHours(f.properties.acquiredAt, now),
  );
  const newest = ages.length > 0 ? Math.min(...ages) : null;

  return (
    <dl className="tile-summary">
      <dt>Tile</dt>
      <dd>
        <code>{tile.tileId}</code>
      </dd>
      <dt>Peak fire probability</dt>
      <dd>{peak === null ? "no data" : `${Math.round(peak * 100)}%`}</dd>
      <dt>Satellite detections</dt>
      <dd>
        {ages.length}
        {newest !== null && ` (newest ${formatAge(newest)})`}
      </dd>
      <dt>Model output</dt>
      <dd>{tile.updatedAt ? formatAge(ageHours(tile.updatedAt, now)) : "unknown"}</dd>
    </dl>
  );
}
