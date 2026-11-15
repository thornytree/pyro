import type { MapViewKind } from "../map/MapView";

const LABELS: Record<MapViewKind, string> = {
  heat: "Heat map",
  terrain: "Terrain",
  satellite: "Satellite",
  map: "Map only",
};

/**
 * The views on offer: the heat-map overlay, then whichever base views are
 * configured. With neither terrain nor imagery, the plain basemap stands in
 * so the overlay can still be switched off.
 */
export function availableViews(hasTerrain: boolean, hasSatellite: boolean): MapViewKind[] {
  const base: MapViewKind[] = [
    ...(hasTerrain ? (["terrain"] as const) : []),
    ...(hasSatellite ? (["satellite"] as const) : []),
  ];
  return ["heat", ...(base.length ? base : (["map"] as const))];
}

/** Switches the map between the heat-map overlay and the view beneath it. */
export function ViewSwitch({
  views,
  view,
  onChange,
}: {
  views: MapViewKind[];
  view: MapViewKind;
  onChange: (view: MapViewKind) => void;
}) {
  return (
    <div className="view-switch segmented" role="radiogroup" aria-label="Map view">
      {views.map((option) => (
        <button
          key={option}
          role="radio"
          aria-checked={option === view}
          className={option === view ? "active" : undefined}
          onClick={() => onChange(option)}
        >
          {LABELS[option]}
        </button>
      ))}
    </div>
  );
}
