import {
  clampHistoryDate,
  defaultHistoryDate,
  HISTORY_START,
  historyEnd,
  isIsoDate,
  LIVE,
  type MapMode,
  shiftDate,
} from "../lib/mode";

interface Props {
  mode: MapMode;
  /** Current time; sets the latest date a replay may use. */
  now: Date;
  onChange: (mode: MapMode) => void;
}

/**
 * Switches between the live / predictive map and a historical replay of one
 * day. In historical mode a date field and day-step buttons pick the day.
 */
export function ModeSwitch({ mode, now, onChange }: Props) {
  const end = historyEnd(now);
  const setDate = (date: string) => onChange({ kind: "historical", date: clampHistoryDate(date, now) });

  return (
    <section className="mode-switch" aria-label="Map mode">
      <div className="segmented" role="radiogroup" aria-label="Which map to show">
        <button
          role="radio"
          aria-checked={mode.kind === "live"}
          className={mode.kind === "live" ? "active" : undefined}
          onClick={() => mode.kind !== "live" && onChange(LIVE)}
        >
          Live / predictive
        </button>
        <button
          role="radio"
          aria-checked={mode.kind === "historical"}
          className={mode.kind === "historical" ? "active historical" : undefined}
          onClick={() =>
            mode.kind !== "historical" &&
            onChange({ kind: "historical", date: defaultHistoryDate(now) })
          }
        >
          Historical
        </button>
      </div>

      {mode.kind === "historical" ? (
        <div className="date-picker">
          <button
            aria-label="Previous day"
            disabled={mode.date <= HISTORY_START}
            onClick={() => setDate(shiftDate(mode.date, -1, now))}
          >
            ‹
          </button>
          <input
            type="date"
            aria-label="Day to replay"
            min={HISTORY_START}
            max={end}
            value={mode.date}
            onChange={(event) => {
              // Browsers report "" while a date is half typed; wait for a full one.
              if (isIsoDate(event.target.value)) setDate(event.target.value);
            }}
          />
          <button
            aria-label="Next day"
            disabled={mode.date >= end}
            onClick={() => setDate(shiftDate(mode.date, 1, now))}
          >
            ›
          </button>
        </div>
      ) : null}
      <p className="hint">
        {mode.kind === "live"
          ? "Current model output, detections from the last 24 hours and predicted spread around extreme-risk areas."
          : "What was observed on this day: archived satellite detections, model hindcast, and fire perimeters where mapped (western US, 2020 to 2024). Replays do not activate tiles."}
      </p>
    </section>
  );
}
