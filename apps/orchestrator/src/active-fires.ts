// Where fire is confirmed right now, from the nationwide FIRMS snapshot: the
// places the spread model (model 2) has something to predict from.
import type { FireDetection } from "./fan-out/types.ts";

export type ActiveFire = {
  /** Centre of the detections, to centre a region on. */
  latitude: number;
  longitude: number;
  detections: number;
  sensors: number;
  frpMaxMw: number | null;
  /** ISO 8601 UTC time of the newest detection. */
  newestAt: string;
};

/** As the spread model: nominal or high confidence, in the last 24 hours. */
const CONFIRM_WINDOW_MS = 24 * 3_600_000;
const LOW_CONFIDENCE_PERCENT = 30;
/** Detections are grouped into boxes this many degrees across, about one region. */
const GROUP_DEGREES = 0.25;

function confirmed(detection: FireDetection, now: number): boolean {
  const age = now - Date.parse(detection.observation_time);
  if (!(age <= CONFIRM_WINDOW_MS)) return false;
  return detection.confidence.kind === "percent"
    ? detection.confidence.value >= LOW_CONFIDENCE_PERCENT
    : detection.confidence.value !== "low";
}

/** The `limit` largest groups of confirmed detections, most detections first. */
export function summarizeActiveFires(detections: FireDetection[], now: number, limit = 50): ActiveFire[] {
  const groups = new Map<string, FireDetection[]>();
  for (const detection of detections) {
    if (!confirmed(detection, now)) continue;
    const { latitude, longitude } = detection.location;
    const key = `${Math.floor(latitude / GROUP_DEGREES)}_${Math.floor(longitude / GROUP_DEGREES)}`;
    const group = groups.get(key);
    if (group) group.push(detection); else groups.set(key, [detection]);
  }
  return [...groups.values()]
    .map((group): ActiveFire => {
      const frp = group.map(d => d.frp_mw).filter((v): v is number => v !== null);
      return {
        latitude: group.reduce((sum, d) => sum + d.location.latitude, 0) / group.length,
        longitude: group.reduce((sum, d) => sum + d.location.longitude, 0) / group.length,
        detections: group.length,
        sensors: new Set(group.map(d => d.source)).size,
        frpMaxMw: frp.length ? Math.max(...frp) : null,
        newestAt: group.reduce((newest, d) => d.observation_time > newest ? d.observation_time : newest, ""),
      };
    })
    .sort((a, b) => b.detections - a.detections || b.newestAt.localeCompare(a.newestAt))
    .slice(0, limit);
}
