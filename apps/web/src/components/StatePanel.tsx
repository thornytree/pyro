import type { StatePreview } from "../api/types";
import { ageHours, formatAge } from "../lib/age";
import { summarizePreview } from "../lib/preview";

export type PreviewSelection =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; preview: StatePreview };

interface Props {
  name: string;
  preview: PreviewSelection;
  onBack: () => void;
  onRetry: () => void;
  onJumpTo: (point: { lat: number; long: number }) => void;
}

export function StatePanel({ name, preview, onBack, onRetry, onJumpTo }: Props) {
  return (
    <section className="state-panel">
      <button className="back" onClick={onBack}>
        ← All states
      </button>
      <h2>{name}</h2>
      {preview.kind === "loading" && <p>Loading statewide preview…</p>}
      {preview.kind === "error" && (
        <>
          <p className="error">Could not load the preview: {preview.message}</p>
          <button onClick={onRetry}>Try again</button>
        </>
      )}
      {preview.kind === "loaded" && <Summary preview={preview.preview} onJumpTo={onJumpTo} />}
    </section>
  );
}

function Summary({
  preview,
  onJumpTo,
}: {
  preview: StatePreview;
  onJumpTo: Props["onJumpTo"];
}) {
  const summary = summarizePreview(preview);
  const pending = summary.tileCount - summary.readyCount;
  return (
    <>
      <dl>
        <dt>Peak fire probability</dt>
        <dd>{summary.peak === null ? "no data" : `${Math.round(summary.peak * 100)}%`}</dd>
        <dt>Tiles at 50% or more</dt>
        <dd>
          {summary.hotCount} of {summary.tileCount}
        </dd>
        {pending > 0 && (
          <>
            <dt>Tiles without output yet</dt>
            <dd>{pending}</dd>
          </>
        )}
        <dt>Preview updated</dt>
        <dd>
          {preview.updatedAt ? formatAge(ageHours(preview.updatedAt, new Date())) : "unknown"}
        </dd>
      </dl>
      {summary.hottest && (
        <button onClick={() => summary.hottest && onJumpTo(summary.hottest)}>
          Open the highest-risk tile
        </button>
      )}
      <p className="hint">
        {summary.tileCount === 0
          ? "No statewide model output is available yet. Click an area to load its source data."
          : "Each square summarizes model output for a tile. Click an area to load the surrounding region."}
      </p>
    </>
  );
}
