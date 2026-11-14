// Which map the user is looking at. Live is current model output and recent
// detections; historical replays one past day. Decision 3 asks for the two to
// be labelled differently, so every view that shows data also shows the mode.

export type MapMode =
  | { kind: "live" }
  /** `date` is a UTC calendar day, YYYY-MM-DD. */
  | { kind: "historical"; date: string };

export const LIVE: MapMode = { kind: "live" };

/** First day of the FIRMS archive (MODIS Terra), the earliest replay date. */
export const HISTORY_START = "2000-11-01";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar day in YYYY-MM-DD form. */
export function isIsoDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

/** Latest replay date: yesterday (UTC). Today is still being observed, so it belongs to live. */
export function historyEnd(now: Date): string {
  return toIsoDate(new Date(now.getTime() - 86_400_000));
}

/** Keeps a date inside [HISTORY_START, historyEnd(now)]. ISO dates compare as strings. */
export function clampHistoryDate(date: string, now: Date): string {
  const end = historyEnd(now);
  if (date < HISTORY_START) return HISTORY_START;
  if (date > end) return end;
  return date;
}

/** Default replay date when the user first switches to historical. */
export function defaultHistoryDate(now: Date): string {
  return historyEnd(now);
}

/**
 * Reads the mode from a URL query string (`?mode=historical&date=2024-08-01`).
 * Anything missing or malformed falls back to live, or to the latest replay
 * date, so a bad shared link still opens a map.
 */
export function modeFromSearch(search: string, now: Date): MapMode {
  const params = new URLSearchParams(search);
  if (params.get("mode") !== "historical") return LIVE;
  const date = params.get("date");
  return {
    kind: "historical",
    date: date && isIsoDate(date) ? clampHistoryDate(date, now) : defaultHistoryDate(now),
  };
}

/** Writes the mode into a query string, keeping any other parameters. */
export function modeToSearch(mode: MapMode, search: string): string {
  const params = new URLSearchParams(search);
  if (mode.kind === "live") {
    params.delete("mode");
    params.delete("date");
  } else {
    params.set("mode", "historical");
    params.set("date", mode.date);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

/**
 * The moment the map describes, used to age detections. Live: now.
 * Historical: the end of the chosen day, so a detection at 18:00 that day
 * shows as about 6 hours old rather than years old.
 */
export function referenceTime(mode: MapMode, now: Date): Date {
  return mode.kind === "live" ? now : new Date(`${mode.date}T23:59:59Z`);
}

export function sameMode(a: MapMode, b: MapMode): boolean {
  return a.kind === b.kind && (a.kind === "live" || a.date === (b as { date: string }).date);
}

export function modeLabel(mode: MapMode): string {
  if (mode.kind === "live") return "Live / predictive";
  return `Historical: ${new Date(`${mode.date}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })}`;
}

/** Moves a replay date by whole days, staying inside the archive. */
export function shiftDate(date: string, days: number, now: Date): string {
  const moved = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
  return clampHistoryDate(toIsoDate(moved), now);
}
