import type { ActiveFire } from "../api/types";
import { ageHours, formatAge } from "../lib/age";

export type FireList =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; fires: Array<ActiveFire & { stateName: string }> };

/**
 * Confirmed fires across CONUS. The spread model only predicts from a
 * confirmed fire, so these are the regions where its output can be seen.
 */
export function ActiveFires({
  list,
  onOpen,
  onRetry,
}: {
  list: FireList;
  onOpen: (fire: ActiveFire) => void;
  onRetry: () => void;
}) {
  return (
    <section className="active-fires">
      <h3>Active fires</h3>
      {list.kind === "loading" && <p className="hint">Looking for confirmed fires…</p>}
      {list.kind === "error" && (
        <>
          <p className="error">Could not load active fires: {list.message}</p>
          <button onClick={onRetry}>Try again</button>
        </>
      )}
      {list.kind === "loaded" &&
        (list.fires.length === 0 ? (
          <p className="hint">
            No confirmed fire in the contiguous US in the last 24 hours, so there is no
            spread to predict right now.
          </p>
        ) : (
          <>
            <p className="hint">Open one to see where the spread model expects it to go.</p>
            <ul>
              {list.fires.map((fire) => (
                <li key={`${fire.latitude},${fire.longitude}`}>
                  <button onClick={() => onOpen(fire)}>
                    {fire.stateName}: {fire.detections} detection{fire.detections === 1 ? "" : "s"},{" "}
                    {formatAge(ageHours(fire.newestAt, new Date()))}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ))}
    </section>
  );
}
