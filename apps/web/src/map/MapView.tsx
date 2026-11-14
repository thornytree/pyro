import { useEffect, useRef, useState } from "react";
import {
  addProtocol,
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapMouseEvent,
} from "maplibre-gl";
// MapLibre locates its worker relative to its own module URL, which a bundler
// rewrites. Hand it the bundled worker asset explicitly.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import mlcontour from "maplibre-contour";
import type { FeatureCollection } from "geojson";
import type { LatLong, StatePreview, TileResponse } from "../api/types";
import { MapHud } from "../components/MapHud";
import type { TerrainConfig } from "../config";
import { ageHours } from "../lib/age";
import { CONUS_BOUNDS } from "../lib/conus";
import { geometryBounds, maskOutside, scaleGeometry } from "../lib/geo";
import { metresPerPixel } from "../lib/scale";
import type { StateFeature } from "../lib/states";
import { resolveClick } from "./interaction";
import {
  CELL_OPACITY,
  CELLS_FILL_LAYER,
  CELLS_SOURCE,
  DETECTIONS_SOURCE,
  LAYERS,
  LIFT_MS,
  LIFT_SCALE,
  LIFT_SOURCE,
  MASK_SOURCE,
  PREVIEW_FILL_LAYER,
  PREVIEW_OPACITY,
  PREVIEW_SOURCE,
  SELECTED_SOURCE,
  STATES_FILL_LAYER,
  STATES_SOURCE,
  TILE_SOURCE,
  uncertaintyOpacity,
} from "./layers";
import {
  basemapFont,
  CONTOUR_THRESHOLDS,
  firstSymbolLayerId,
  TERRAIN_LAYER_IDS,
  terrainLayers,
  terrainSources,
} from "./terrain";

setWorkerUrl(workerUrl);

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const DATA_SOURCES = [CELLS_SOURCE, TILE_SOURCE, DETECTIONS_SOURCE, PREVIEW_SOURCE];
const CONUS: [number, number, number, number] = [
  CONUS_BOUNDS.west,
  CONUS_BOUNDS.south,
  CONUS_BOUNDS.east,
  CONUS_BOUNDS.north,
];

interface Props {
  styleUrl: string;
  /** Elevation drawn under the live heat map; null turns terrain off. */
  terrain: TerrainConfig | null;
  states: StateFeature[];
  selectedState: StateFeature | null;
  preview: StatePreview | null;
  tile: TileResponse | null;
  onSelectState: (fips: string) => void;
  onSelectPoint: (point: LatLong) => void;
}

function rectangle([west, south, east, north]: number[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [west ?? 0, south ?? 0],
              [east ?? 0, south ?? 0],
              [east ?? 0, north ?? 0],
              [west ?? 0, north ?? 0],
              [west ?? 0, south ?? 0],
            ],
          ],
        },
      },
    ],
  };
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Keeps the side panel from covering the area being framed. */
function framePadding(map: MapLibreMap) {
  const narrow = map.getContainer().clientWidth < 600;
  return narrow ? 24 : { top: 40, bottom: 40, right: 60, left: 380 };
}

/**
 * Registers the contour library's MapLibre protocols for a DEM. Contour lines
 * are generated in a web worker from the same DEM tiles the hillshade uses.
 */
function setupTerrain(map: MapLibreMap, config: TerrainConfig) {
  const dem = new mlcontour.DemSource({
    url: config.demUrl,
    encoding: config.encoding,
    maxzoom: config.maxZoom,
    worker: true,
  });
  dem.setupMaplibre({ addProtocol });
  const sources = terrainSources(config, {
    // Shares one DEM tile cache between the hillshade and the contours.
    dem: dem.sharedDemProtocolUrl,
    contours: dem.contourProtocolUrl({
      thresholds: CONTOUR_THRESHOLDS,
      elevationKey: "ele",
      levelKey: "level",
      contourLayer: "contours",
    }),
  });
  for (const [id, source] of Object.entries(sources)) map.addSource(id, source);
  const basemapLayers = map.getStyle().layers;
  const beforeId = firstSymbolLayerId(basemapLayers);
  // Contour labels need glyphs; borrow a font the basemap already serves.
  const font = map.getStyle().glyphs ? basemapFont(basemapLayers) : null;
  for (const layer of terrainLayers(font)) map.addLayer(layer, beforeId);
}

export function MapView({
  styleUrl,
  terrain,
  states,
  selectedState,
  preview,
  tile,
  onSelectState,
  onSelectPoint,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [metresPerPx, setMetresPerPx] = useState<number | null>(null);

  // Handlers are bound once; they read the latest props through refs.
  const latest = useRef({ states, selectedState, onSelectState, onSelectPoint });
  latest.current = { states, selectedState, onSelectState, onSelectPoint };

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: styleUrl,
      bounds: CONUS,
      fitBoundsOptions: { padding: 24 },
      // North stays up and the view stays flat, so the fixed compass is
      // always right and the scale bar holds across the whole view.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
    });
    map.keyboard.disableRotation();
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");

    const updateScale = () =>
      setMetresPerPx(metresPerPixel(map.getCenter().lat, map.getZoom()));
    map.on("move", updateScale);

    let hoveredState: number | null = null;
    let hoveredTile: string | null = null;
    let animation = 0;

    const setLift = (stateId: number | null) => {
      cancelAnimationFrame(animation);
      const lift = map.getSource<GeoJSONSource>(LIFT_SOURCE);
      const state =
        stateId === null ? undefined : latest.current.states.find((s) => s.id === stateId);
      if (!lift || !state || latest.current.selectedState) {
        lift?.setData(EMPTY);
        return;
      }
      const draw = (factor: number) =>
        lift.setData({
          type: "FeatureCollection",
          features: [{ ...state, geometry: scaleGeometry(state.geometry, factor) }],
        });
      if (prefersReducedMotion()) {
        draw(LIFT_SCALE);
        return;
      }
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / LIFT_MS);
        const eased = 1 - (1 - t) ** 3;
        draw(1 + (LIFT_SCALE - 1) * eased);
        if (t < 1) animation = requestAnimationFrame(step);
      };
      animation = requestAnimationFrame(step);
    };

    const setHoveredState = (id: number | null) => {
      if (id === hoveredState) return;
      if (hoveredState !== null) {
        map.setFeatureState({ source: STATES_SOURCE, id: hoveredState }, { hover: false });
      }
      hoveredState = id;
      if (id !== null) map.setFeatureState({ source: STATES_SOURCE, id }, { hover: true });
      setLift(id);
    };

    const setHoveredTile = (id: string | null) => {
      if (id === hoveredTile) return;
      if (hoveredTile !== null) {
        map.setFeatureState({ source: PREVIEW_SOURCE, id: hoveredTile }, { hover: false });
      }
      hoveredTile = id;
      if (id !== null) map.setFeatureState({ source: PREVIEW_SOURCE, id }, { hover: true });
    };

    const stateAt = (event: MapMouseEvent) =>
      map.queryRenderedFeatures(event.point, { layers: [STATES_FILL_LAYER] })[0];

    map.on("load", () => {
      for (const id of DATA_SOURCES) {
        map.addSource(id, {
          type: "geojson",
          data: EMPTY,
          ...(id === PREVIEW_SOURCE && { promoteId: "tileId" }),
        });
      }
      map.addSource(STATES_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: latest.current.states },
      });
      for (const id of [MASK_SOURCE, SELECTED_SOURCE, LIFT_SOURCE]) {
        map.addSource(id, { type: "geojson", data: EMPTY });
      }
      if (terrain) setupTerrain(map, terrain);
      for (const layer of LAYERS) map.addLayer(layer);
      updateScale();
      setReady(true);
    });

    map.on("mousemove", (event) => {
      const state = stateAt(event);
      const stateId = typeof state?.id === "number" ? state.id : null;
      const selected = latest.current.selectedState;
      // In a state, hovering it highlights the tile a click would load.
      const inSelected = selected !== null && stateId === selected.id;
      setHoveredState(inSelected ? null : stateId);
      const previewTile = inSelected
        ? map.queryRenderedFeatures(event.point, { layers: [PREVIEW_FILL_LAYER] })[0]
        : undefined;
      setHoveredTile(typeof previewTile?.id === "string" ? previewTile.id : null);
      map.getCanvas().style.cursor = stateId === null ? "" : "pointer";
    });

    map.on("mouseout", () => {
      setHoveredState(null);
      setHoveredTile(null);
      map.getCanvas().style.cursor = "";
    });

    map.on("click", (event) => {
      const { selectedState: selected, onSelectState: openState, onSelectPoint: loadTile } =
        latest.current;
      const fips = stateAt(event)?.properties?.fips;
      const intent = resolveClick(
        selected?.properties.fips ?? null,
        typeof fips === "string" ? fips : null,
      );
      if (intent.kind === "open-state") {
        setHoveredState(null);
        openState(intent.fips);
      } else if (intent.kind === "load-tile") {
        loadTile({ lat: event.lngLat.lat, long: event.lngLat.lng });
      }
    });

    return () => {
      cancelAnimationFrame(animation);
      setReady(false);
      mapRef.current = null;
      map.remove();
    };
  }, [styleUrl, terrain]);

  // Open state: mask the rest of the map, outline it and frame it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const set = (id: string, data: FeatureCollection) =>
      map.getSource<GeoJSONSource>(id)?.setData(data);

    set(LIFT_SOURCE, EMPTY);
    if (!selectedState) {
      set(MASK_SOURCE, EMPTY);
      set(SELECTED_SOURCE, EMPTY);
      map.fitBounds(CONUS, { padding: 24 });
      return;
    }
    set(MASK_SOURCE, {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: maskOutside(selectedState.geometry) }],
    });
    set(SELECTED_SOURCE, { type: "FeatureCollection", features: [selectedState] });
    map.fitBounds(geometryBounds(selectedState.geometry), {
      padding: framePadding(map),
      maxZoom: 8,
    });
  }, [selectedState, ready]);

  useEffect(() => {
    if (!ready) return;
    mapRef.current?.getSource<GeoJSONSource>(PREVIEW_SOURCE)?.setData(preview?.tiles ?? EMPTY);
  }, [preview, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const set = (id: string, data: FeatureCollection) =>
      map.getSource<GeoJSONSource>(id)?.setData(data);

    // The full-resolution tile replaces its coarse preview square.
    map.setFilter(PREVIEW_FILL_LAYER, tile ? ["!=", ["get", "tileId"], tile.tileId] : null);

    // Terrain shows only in the tile view, with the heat map lightened over it.
    const overTerrain = tile !== null && map.getLayer(TERRAIN_LAYER_IDS[0]) !== undefined;
    for (const id of TERRAIN_LAYER_IDS) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", overTerrain ? "visible" : "none");
      }
    }
    const opacity = overTerrain ? "overTerrain" : "plain";
    map.setPaintProperty(
      CELLS_FILL_LAYER,
      "fill-opacity",
      uncertaintyOpacity("uncertainty", CELL_OPACITY[opacity]),
    );
    map.setPaintProperty(
      PREVIEW_FILL_LAYER,
      "fill-opacity",
      uncertaintyOpacity("meanUncertainty", PREVIEW_OPACITY[opacity]),
    );
    if (!tile) {
      for (const id of [CELLS_SOURCE, TILE_SOURCE, DETECTIONS_SOURCE]) set(id, EMPTY);
      return;
    }
    const now = new Date();
    set(CELLS_SOURCE, tile.cells);
    set(TILE_SOURCE, rectangle(tile.bounds));
    set(DETECTIONS_SOURCE, {
      type: "FeatureCollection",
      features: tile.detections.features.map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          ageHours: ageHours(feature.properties.acquiredAt, now),
        },
      })),
    });
    const [west, south, east, north] = tile.bounds;
    map.fitBounds([west, south, east, north], { padding: framePadding(map), maxZoom: 9 });
  }, [tile, ready]);

  return (
    <>
      <div ref={containerRef} className="map" data-ready={ready} />
      <MapHud metresPerPx={metresPerPx} />
    </>
  );
}
