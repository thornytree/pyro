import { NO_DATA_COLOUR, PROBABILITY_STOPS } from "../map/layers";
import { ELEVATION_STOPS } from "../map/terrain";

function ElevationLegend() {
  const top = ELEVATION_STOPS[ELEVATION_STOPS.length - 1]?.[0] ?? 1;
  const gradient = ELEVATION_STOPS.map(
    ([metres, colour]) => `${colour} ${(metres / top) * 100}%`,
  ).join(", ");
  return (
    <>
      <div className="legend-subtitle">Elevation</div>
      <div className="legend-bar" style={{ background: `linear-gradient(to right, ${gradient})` }} />
      <div className="legend-scale">
        <span>0 m</span>
        <span>{top.toLocaleString("en-US")} m+</span>
      </div>
      <p className="hint">
        Shaded relief and contour lines (metres); spacing tightens as you zoom in.
      </p>
    </>
  );
}

/** `terrain`: the tile view is drawing elevation under the heat map. */
export function Legend({ terrain }: { terrain: boolean }) {
  const gradient = PROBABILITY_STOPS.map(
    ([stop, colour]) => `${colour} ${stop * 100}%`,
  ).join(", ");
  return (
    <div className="legend">
      <div className="legend-title">Fire probability</div>
      <div
        className="legend-bar"
        style={{ background: `linear-gradient(to right, ${gradient})` }}
      />
      <div className="legend-scale">
        <span>0%</span>
        <span>100%</span>
      </div>
      <div className="legend-nodata">
        <span className="swatch" style={{ background: NO_DATA_COLOUR }} /> No model
        output yet
      </div>
      <p className="hint">
        Fainter cells are less certain. Dots are satellite detections; they fade
        with age.
      </p>
      {terrain && <ElevationLegend />}
    </div>
  );
}
