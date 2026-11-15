import { NO_DATA_COLOUR, PERIMETER_COLOUR, PROBABILITY_STOPS, SPREAD_COLOUR } from "../map/layers";
import { SPREAD_HORIZONS } from "../lib/spread";
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

export type LegendOverlay = "spread" | "perimeters" | null;

function OverlayLegend({ overlay }: { overlay: Exclude<LegendOverlay, null> }) {
  if (overlay === "perimeters") {
    return (
      <div className="legend-nodata">
        <span className="swatch outline" style={{ borderColor: PERIMETER_COLOUR }} /> Observed
        fire perimeter that day
      </div>
    );
  }
  return (
    <div className="legend-nodata">
      <span className="swatch outline dashed" style={{ borderColor: SPREAD_COLOUR }} /> Predicted
      spread at {SPREAD_HORIZONS.join(", ")} h; arrow shows the head fire
    </div>
  );
}

/**
 * `terrain`: the tile view is drawing elevation under the heat map.
 * `overlay`: spread outlines (live) or perimeters (historical) on the map.
 * `historical`: cell colours are a hindcast, not a forecast.
 */
export function Legend({
  terrain,
  overlay,
  historical,
  relativeScore = false,
}: {
  terrain: boolean;
  overlay: LegendOverlay;
  historical: boolean;
  relativeScore?: boolean;
}) {
  const gradient = PROBABILITY_STOPS.map(
    ([stop, colour]) => `${colour} ${stop * 100}%`,
  ).join(", ");
  return (
    <div className="legend">
      <div className="legend-title">
        {relativeScore ? "Daily fire-detection score" : "Fire probability"}{historical && " (hindcast for the chosen day)"}
      </div>
      <div
        className="legend-bar"
        style={{ background: `linear-gradient(to right, ${gradient})` }}
      />
      <div className="legend-scale">
        <span>{relativeScore ? "0" : "0%"}</span>
        <span>{relativeScore ? "100" : "100%"}</span>
      </div>
      <div className="legend-nodata">
        <span className="swatch" style={{ background: NO_DATA_COLOUR }} /> No model
        output yet
      </div>
      <p className="hint">
        {relativeScore ? "Fainter cells indicate greater model disagreement." : "Fainter cells are less certain."} Dots are satellite detections; they fade with age.
      </p>
      {overlay && <OverlayLegend overlay={overlay} />}
      {terrain && <ElevationLegend />}
    </div>
  );
}
