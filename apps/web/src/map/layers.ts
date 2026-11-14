import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";

export const CELLS_SOURCE = "pyro-cells";
export const DETECTIONS_SOURCE = "pyro-detections";
export const TILE_SOURCE = "pyro-tile";
export const STATES_SOURCE = "pyro-states";
export const PREVIEW_SOURCE = "pyro-preview";
export const MASK_SOURCE = "pyro-mask";
export const SELECTED_SOURCE = "pyro-selected-state";
export const LIFT_SOURCE = "pyro-lift";
export const USER_SOURCE = "pyro-user-location";

export const STATES_FILL_LAYER = "pyro-states-fill";
export const PREVIEW_FILL_LAYER = "pyro-preview-fill";

/** How much a hovered state grows, and how long the grow animation takes. */
export const LIFT_SCALE = 1.08;
export const LIFT_MS = 140;

/** Preview tiles with no model output yet. */
export const NO_DATA_COLOUR = "#5a5a66";

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

const probabilityColour = (property: string): ExpressionSpecification => [
  "case",
  ["!=", ["typeof", ["get", property]], "number"],
  NO_DATA_COLOUR,
  ["interpolate", ["linear"], ["get", property], ...PROBABILITY_STOPS.flat()],
];

const hovered: ExpressionSpecification = ["boolean", ["feature-state", "hover"], false];

/** Bottom to top. */
export const LAYERS: LayerSpecification[] = [
  {
    // Also the hit target for hover and click, so it is never fully transparent.
    id: STATES_FILL_LAYER,
    type: "fill",
    source: STATES_SOURCE,
    paint: { "fill-color": "#ffffff", "fill-opacity": ["case", hovered, 0.08, 0.02] },
  },
  {
    id: "pyro-states-line",
    type: "line",
    source: STATES_SOURCE,
    paint: {
      "line-color": "#ffffff",
      "line-opacity": ["case", hovered, 0.9, 0.35],
      "line-width": ["case", hovered, 1.5, 0.75],
    },
  },
  {
    id: PREVIEW_FILL_LAYER,
    type: "fill",
    source: PREVIEW_SOURCE,
    paint: {
      "fill-color": probabilityColour("peakProbability"),
      "fill-opacity": [
        "interpolate",
        ["linear"],
        ["coalesce", ["get", "meanUncertainty"], 1],
        0,
        0.75,
        1,
        0.3,
      ],
    },
  },
  {
    // Dims everything outside the open state and trims preview squares that
    // stick out past its border.
    id: "pyro-mask",
    type: "fill",
    source: MASK_SOURCE,
    paint: { "fill-color": "#0b0b10", "fill-opacity": 0.72 },
  },
  {
    id: "pyro-preview-hover",
    type: "line",
    source: PREVIEW_SOURCE,
    paint: { "line-color": "#ffffff", "line-width": 2, "line-opacity": ["case", hovered, 1, 0] },
  },
  {
    id: "pyro-selected-state-line",
    type: "line",
    source: SELECTED_SOURCE,
    paint: { "line-color": "#fe9f6d", "line-width": 2 },
  },
  {
    id: "pyro-cells-fill",
    type: "fill",
    source: CELLS_SOURCE,
    paint: {
      "fill-color": probabilityColour("probability"),
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
  // Hovered state, drawn enlarged and raised above the map (national view only).
  {
    id: "pyro-lift-shadow",
    type: "fill",
    source: LIFT_SOURCE,
    paint: { "fill-color": "#000000", "fill-opacity": 0.45, "fill-translate": [4, 6] },
  },
  {
    id: "pyro-lift-fill",
    type: "fill",
    source: LIFT_SOURCE,
    paint: { "fill-color": "#3a2a3e", "fill-opacity": 0.92 },
  },
  {
    id: "pyro-lift-line",
    type: "line",
    source: LIFT_SOURCE,
    paint: { "line-color": "#fe9f6d", "line-width": 2 },
  },
  {
    id: "pyro-user-location",
    type: "circle",
    source: USER_SOURCE,
    paint: {
      "circle-radius": 6,
      "circle-color": "#4da3ff",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  },
];
