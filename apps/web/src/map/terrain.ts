import type {
  ExpressionSpecification,
  LayerSpecification,
  SourceSpecification,
} from "maplibre-gl";
import type { TerrainConfig } from "../config";

export const TERRAIN_DEM_SOURCE = "pyro-terrain-dem";
export const CONTOUR_SOURCE = "pyro-terrain-contours";
/** Layer name inside the generated contour vector tiles. */
const CONTOUR_SOURCE_LAYER = "contours";

/**
 * Contour spacing in metres by zoom: [minor, major]. Majors are drawn heavier
 * and labelled. At the tile view (about zoom 9) a 50 km tile gets 100 m lines.
 */
export const CONTOUR_THRESHOLDS: Record<number, [number, number]> = {
  7: [250, 1000],
  8: [200, 1000],
  9: [100, 500],
  10: [50, 250],
  11: [50, 200],
  12: [20, 100],
  13: [10, 50],
};

/**
 * Elevation tint in metres, shared by the map layer and the legend. Muted and
 * desaturated so the fire-probability ramp stays the loudest colour on screen.
 * Below sea level is transparent so bathymetry does not tint the ocean.
 */
export const ELEVATION_STOPS: ReadonlyArray<readonly [number, string]> = [
  [0, "#2f4a3c"],
  [500, "#4f6347"],
  [1000, "#6f7150"],
  [2000, "#8a7a62"],
  [3000, "#a59c90"],
  [4000, "#e4e2de"],
];

const TERRAIN_OPACITY = { relief: 0.55, hillshade: 0.6 };

/** Every terrain layer, so the map can show or hide them together. */
export const TERRAIN_LAYER_IDS = [
  "pyro-terrain-relief",
  "pyro-terrain-hillshade",
  "pyro-contour-minor",
  "pyro-contour-major",
  "pyro-contour-label",
] as const;

/** URLs the sources read from; MapLibre protocols handle the contour one. */
export interface TerrainUrls {
  /** Raster DEM tiles (possibly routed through the contour library's cache). */
  dem: string;
  /** Vector contour tiles generated in the browser from the same DEM. */
  contours: string;
}

export function terrainSources(
  config: TerrainConfig,
  urls: TerrainUrls,
): Record<string, SourceSpecification> {
  return {
    [TERRAIN_DEM_SOURCE]: {
      type: "raster-dem",
      tiles: [urls.dem],
      encoding: config.encoding,
      tileSize: 256,
      // Credited in the panel footer rather than the map's attribution
      // control, which would otherwise grow over the panel on phones.
      maxzoom: config.maxZoom,
    },
    [CONTOUR_SOURCE]: {
      type: "vector",
      tiles: [urls.contours],
      maxzoom: config.maxZoom,
    },
  };
}

const elevationTint: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["elevation"],
  -1,
  "rgba(0, 0, 0, 0)",
  ...ELEVATION_STOPS.flat(),
];

const isMajor: ExpressionSpecification = ["==", ["get", "level"], 1];

/**
 * Terrain layers, bottom to top. They start hidden; the map shows them only in
 * the tile view. `font` is a text-font the basemap's glyph server can serve;
 * without one the contour labels are left out.
 */
export function terrainLayers(font: string[] | null): LayerSpecification[] {
  const hidden = { visibility: "none" } as const;
  const layers: LayerSpecification[] = [
    {
      id: "pyro-terrain-relief",
      type: "color-relief",
      source: TERRAIN_DEM_SOURCE,
      layout: hidden,
      paint: {
        "color-relief-color": elevationTint,
        "color-relief-opacity": TERRAIN_OPACITY.relief,
      },
    },
    {
      id: "pyro-terrain-hillshade",
      type: "hillshade",
      source: TERRAIN_DEM_SOURCE,
      layout: hidden,
      paint: {
        "hillshade-method": "multidirectional",
        "hillshade-exaggeration": TERRAIN_OPACITY.hillshade,
        "hillshade-shadow-color": "#000000",
        "hillshade-highlight-color": "rgba(255, 255, 255, 0.35)",
        "hillshade-accent-color": "#000000",
      },
    },
    {
      id: "pyro-contour-minor",
      type: "line",
      source: CONTOUR_SOURCE,
      "source-layer": CONTOUR_SOURCE_LAYER,
      filter: ["!", isMajor],
      layout: hidden,
      paint: { "line-color": "#e8dcc8", "line-opacity": 0.22, "line-width": 0.6 },
    },
    {
      id: "pyro-contour-major",
      type: "line",
      source: CONTOUR_SOURCE,
      "source-layer": CONTOUR_SOURCE_LAYER,
      filter: isMajor,
      layout: hidden,
      paint: { "line-color": "#e8dcc8", "line-opacity": 0.45, "line-width": 1.1 },
    },
  ];
  if (font) {
    layers.push({
      id: "pyro-contour-label",
      type: "symbol",
      source: CONTOUR_SOURCE,
      "source-layer": CONTOUR_SOURCE_LAYER,
      filter: isMajor,
      layout: {
        ...hidden,
        "symbol-placement": "line",
        "text-field": ["concat", ["number-format", ["get", "ele"], {}], " m"],
        "text-font": font,
        "text-size": 10,
        "text-max-angle": 30,
      },
      paint: {
        "text-color": "#e8dcc8",
        "text-halo-color": "rgba(11, 11, 16, 0.85)",
        "text-halo-width": 1.2,
      },
    });
  }
  return layers;
}

interface StyleLayerLike {
  id: string;
  type: string;
  layout?: Record<string, unknown>;
}

/**
 * The first basemap symbol layer. Terrain goes beneath it so place names and
 * road labels stay readable on top of the relief.
 */
export function firstSymbolLayerId(layers: readonly StyleLayerLike[]): string | undefined {
  return layers.find((layer) => layer.type === "symbol")?.id;
}

/** Operators that make a text-font array an expression, not a font list. */
const EXPRESSION_OPERATORS = new Set([
  "get", "case", "match", "coalesce", "step", "interpolate", "concat", "to-string", "array",
]);

/**
 * A text-font the basemap already uses, so contour labels request glyphs its
 * glyph server is known to have. Null if no layer names a literal font list.
 */
export function basemapFont(layers: readonly StyleLayerLike[]): string[] | null {
  for (const layer of layers) {
    let font = layer.layout?.["text-font"];
    // Also accept the expression form ["literal", [...fonts]].
    if (Array.isArray(font) && font[0] === "literal") font = font[1];
    if (
      Array.isArray(font) &&
      font.length > 0 &&
      !EXPRESSION_OPERATORS.has(font[0]) &&
      font.every((f) => typeof f === "string")
    ) {
      return font as string[];
    }
  }
  return null;
}
