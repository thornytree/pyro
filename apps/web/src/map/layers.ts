import type { LayerSpecification } from "maplibre-gl";

export const CELLS_SOURCE = "pyro-cells";
export const DETECTIONS_SOURCE = "pyro-detections";
export const TILE_SOURCE = "pyro-tile";

/** Probability colour ramp, shared by the map layer and the legend. */
export const PROBABILITY_STOPS: ReadonlyArray<readonly [number, string]> = [
  [0, "#2b1055"],
  [0.25, "#8c2981"],
  [0.5, "#de4968"],
  [0.75, "#fe9f6d"],
  [1, "#fcfdbf"],
];

/** Detections older than this are drawn at minimum opacity. */
export const DETECTION_FADE_HOURS = 24;

export const LAYERS: LayerSpecification[] = [
  {
    id: "pyro-cells-fill",
    type: "fill",
    source: CELLS_SOURCE,
    paint: {
      "fill-color": [
        "interpolate",
        ["linear"],
        ["get", "probability"],
        ...PROBABILITY_STOPS.flat(),
      ],
      // Less certain cells are drawn fainter.
      "fill-opacity": [
        "interpolate",
        ["linear"],
        ["get", "uncertainty"],
        0,
        0.8,
        1,
        0.25,
      ],
    },
  },
  {
    id: "pyro-tile-outline",
    type: "line",
    source: TILE_SOURCE,
    paint: { "line-color": "#ffffff", "line-width": 1.5, "line-dasharray": [3, 2] },
  },
  {
    id: "pyro-detections",
    type: "circle",
    source: DETECTIONS_SOURCE,
    paint: {
      "circle-radius": 5,
      "circle-color": "#ffffff",
      "circle-stroke-color": "#111111",
      "circle-stroke-width": 1.5,
      // Fresh detections are solid; they fade as they age.
      "circle-opacity": [
        "interpolate",
        ["linear"],
        ["get", "ageHours"],
        0,
        1,
        DETECTION_FADE_HOURS,
        0.3,
      ],
    },
  },
];
