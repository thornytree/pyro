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
  historyAvailable?: boolean;
  /** Current time; sets the latest date a replay may use. */
  now: Date;
  onChange: (mode: MapMode) => void;
}

/**
 * Switches between the live / predictive map and a historical replay of one
 * day. In historical mode a date field and day-step buttons pick the day.
 */
export function ModeSwitch({ mode, now, onChange, historyAvailable = true }: Props) {
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
          {historyAvailable ? "Live / predictive" : "Live observations"}
        </button>
        <button
          role="radio"
          aria-checked={mode.kind === "historical"}
          disabled={!historyAvailable}
          title={historyAvailable ? undefined : "Historical replay is available in mock mode until the archive API is connected."}
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
        {!historyAvailable
          ? "Current observations and an experimental daily detection model where available. Historical replay and spread are not connected yet."
          : mode.kind === "live"
            ? "Current observations and experimental daily fire-detection scores."
            : "Replay available archived samples for a past day. Use the archived example button to find data; coverage is sparse."}
      </p>
    </section>
  );
}
