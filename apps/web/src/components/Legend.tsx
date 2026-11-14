import { PROBABILITY_STOPS } from "../map/layers";

export function Legend() {
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
      <p className="hint">
        Fainter cells are less certain. Dots are satellite detections; they fade
        with age.
      </p>
    </div>
  );
}
