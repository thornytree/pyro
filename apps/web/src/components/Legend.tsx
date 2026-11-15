import { DETECTION_FADE_HOURS, NO_DATA_COLOUR, PERIMETER_COLOUR, PROBABILITY_STOPS, SPREAD_COLOUR } from "../map/layers";
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

/** Key for the white dots: what they are, and what their brightness and size mean. */
function DetectionLegend({ generated }: { generated: boolean }) {
  return (
    <>
      <div className="legend-subtitle">Satellite fire detections</div>
      <div className="legend-nodata">
        <span className="dot" /> Hotspot seen by a satellite{" "}
        {generated ? "(generated sample data)" : "(NASA FIRMS: MODIS and VIIRS)"}
      </div>
      <div className="legend-nodata">
        <span className="dot" />
        <span className="dot faded" /> Newest are solid; they fade over{" "}
        {DETECTION_FADE_HOURS} hours
      </div>
      <div className="legend-nodata">
        <span className="dot small" />
        <span className="dot" /> Small: whole state. Large: the region you clicked
      </div>
      <p className="hint">
        These are observations, not model output, so they stay on in every view.
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
 * `terrain`: the map is drawing elevation (terrain view, or under a loaded region).
 * `overlay`: spread outlines (live) or perimeters (historical) on the map.
 * `historical`: cell colours are a hindcast, not a forecast.
 * `generated`: mock mode, where the detections are not real.
 */
export function Legend({
  terrain,
  overlay,
  historical,
  relativeScore = false,
  generated = false,
}: {
  terrain: boolean;
  overlay: LegendOverlay;
  historical: boolean;
  relativeScore?: boolean;
  generated?: boolean;
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
        {relativeScore ? "Fainter areas indicate greater model disagreement." : "Fainter areas are less certain."}
      </p>
      <DetectionLegend generated={generated} />
      {overlay && <OverlayLegend overlay={overlay} />}
      {terrain && <ElevationLegend />}
    </div>
  );
}
