import { useMemo } from "react";
import type { StateHeatmap } from "../api/types";
import { ageHours, formatAge } from "../lib/age";
import { createPointTester } from "../lib/geo";
import { summarizeHeatmap } from "../lib/heatmap";
import type { StateFeature } from "../lib/states";

export type HeatmapSelection =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  /** `heatmap` is null when the mode has no statewide data. */
  | { kind: "loaded"; heatmap: StateHeatmap | null };

interface Props {
  state: StateFeature;
  heatmap: HeatmapSelection;
  onBack: () => void;
  onRetry: () => void;
  onJumpTo: (point: { lat: number; long: number }) => void;
}

export function StatePanel({ state, heatmap, onBack, onRetry, onJumpTo }: Props) {
  return (
    <section className="state-panel">
      <button className="back" onClick={onBack}>
        ← All states
      </button>
      <h2>{state.properties.name}</h2>
      {heatmap.kind === "loading" && <p>Loading statewide heat map…</p>}
      {heatmap.kind === "error" && (
        <>
          <p className="error">Could not load the heat map: {heatmap.message}</p>
          <button onClick={onRetry}>Try again</button>
        </>
      )}
      {heatmap.kind === "loaded" &&
        (heatmap.heatmap ? (
          <Summary state={state} heatmap={heatmap.heatmap} onJumpTo={onJumpTo} />
        ) : (
          <p className="hint">
            There is no statewide archive for past days. Click an area to load its archived
            samples.
          </p>
        ))}
    </section>
  );
}

function Summary({
  state,
  heatmap,
  onJumpTo,
}: {
  state: StateFeature;
  heatmap: StateHeatmap;
  onJumpTo: Props["onJumpTo"];
}) {
  const summary = useMemo(
    () => summarizeHeatmap(heatmap, createPointTester(state.geometry)),
    [heatmap, state],
  );
  const relative = heatmap.prediction?.scoreKind === "sample_relative";
  const value = (p: number) => (relative ? String(Math.round(p * 100)) : `${Math.round(p * 100)}%`);
  const { hottest } = summary;
  return (
    <>
      <dl>
        {heatmap.grid && (
          <>
            <dt>{relative ? "Peak daily fire-detection score" : "Peak fire probability"}</dt>
            <dd>{summary.peak === null ? "no data" : value(summary.peak)}</dd>
            <dt>Area at {value(0.5)} or more</dt>
            <dd>{Math.round(summary.hotShare * 100)}% of the state</dd>
            <dt>Resolution</dt>
            <dd>one scored point every {Math.round(heatmap.grid.spacingKm)} km</dd>
          </>
        )}
        <dt>Satellite detections</dt>
        <dd>{heatmap.detections.features.length}</dd>
        <dt>Updated</dt>
        <dd>{heatmap.updatedAt ? formatAge(ageHours(heatmap.updatedAt, new Date())) : "unknown"}</dd>
      </dl>
      {hottest && <button onClick={() => onJumpTo(hottest)}>Open the highest-risk area</button>}
      {heatmap.inference?.status === "unavailable" && (
        <p className="hint">{heatmap.inference.message}</p>
      )}
      {heatmap.sourceFailures?.map((failure) => (
        <p className="hint" key={failure.source}>
          {failure.message}
        </p>
      ))}
      <p className="hint">
        {heatmap.grid
          ? "The heat map covers the whole state. Click an area to load its detailed region and source data."
          : "No statewide model output is available. Click an area to load its source data."}
      </p>
    </>
  );
}
