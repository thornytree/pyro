import { scaleBar } from "../lib/scale";

/** Longest a scale bar may be drawn, in CSS pixels. */
const SCALE_MAX_WIDTH_PX = 120;

/**
 * North arrow. The map does not rotate or tilt (see MapView), so north is
 * always straight up and the arrow is fixed.
 */
function Compass() {
  return (
    <svg className="compass" viewBox="0 0 40 40" role="img" aria-label="North is up">
      <circle cx="20" cy="22" r="15.5" />
      <path className="needle-north" d="M20 10 L24.5 22 L20 20 L15.5 22 Z" />
      <path className="needle-south" d="M20 34 L24.5 22 L20 24 L15.5 22 Z" />
      <text x="20" y="8" textAnchor="middle">
        N
      </text>
    </svg>
  );
}

function ScaleRow({ metresPerPx, unit }: { metresPerPx: number; unit: "metric" | "imperial" }) {
  const { widthPx, label } = scaleBar(metresPerPx, SCALE_MAX_WIDTH_PX, unit);
  return (
    <div className="scale-row">
      <span className="scale-bar" style={{ width: `${widthPx}px` }} />
      <span className="scale-label">{label}</span>
    </div>
  );
}

/** Fixed map overlay: north arrow and a metric / imperial scale bar. */
export function MapHud({ metresPerPx }: { metresPerPx: number | null }) {
  return (
    <div className="map-hud" aria-hidden={metresPerPx === null}>
      <Compass />
      {metresPerPx !== null && (
        <div className="scale" aria-label="Map scale at the centre of the view">
          <ScaleRow metresPerPx={metresPerPx} unit="metric" />
          <ScaleRow metresPerPx={metresPerPx} unit="imperial" />
        </div>
      )}
    </div>
  );
}
