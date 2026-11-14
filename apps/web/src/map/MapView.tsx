import { useEffect, useRef, useState } from "react";
import {
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
import type { FeatureCollection } from "geojson";
import type { LatLong, StatePreview, TileResponse } from "../api/types";
import { ageHours } from "../lib/age";
import { CONUS_BOUNDS } from "../lib/conus";
import { geometryBounds, maskOutside, scaleGeometry } from "../lib/geo";
import { stateAt as stateContaining, type StateFeature } from "../lib/states";
import { resolveClick, resolveZoom } from "./interaction";
import {
  CELLS_SOURCE,
  DETECTIONS_SOURCE,
  LAYERS,
  LIFT_MS,
  LIFT_SCALE,
  LIFT_SOURCE,
  MASK_SOURCE,
  PREVIEW_FILL_LAYER,
  PREVIEW_SOURCE,
  SELECTED_SOURCE,
  STATES_FILL_LAYER,
  STATES_SOURCE,
  TILE_SOURCE,
  USER_SOURCE,
} from "./layers";

setWorkerUrl(workerUrl);

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const DATA_SOURCES = [CELLS_SOURCE, TILE_SOURCE, DETECTIONS_SOURCE, PREVIEW_SOURCE];
const NATIONAL_PADDING = 24;
const STATE_MAX_ZOOM = 8;
const TILE_MAX_ZOOM = 9;
/** Marks camera moves made by the app, so zoom handling only reacts to the user. */
const AUTO = { pyroAuto: true };
const CONUS: [number, number, number, number] = [
  CONUS_BOUNDS.west,
  CONUS_BOUNDS.south,
  CONUS_BOUNDS.east,
  CONUS_BOUNDS.north,
];

interface Props {
  styleUrl: string;
  states: StateFeature[];
  selectedState: StateFeature | null;
  preview: StatePreview | null;
  tile: TileResponse | null;
  userLocation: LatLong | null;
  onSelectState: (fips: string) => void;
  onClearState: () => void;
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

function point({ lat, long }: LatLong): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [long, lat] } }],
  };
}

/** Keeps the side panel from covering the area being framed. */
function framePadding(map: MapLibreMap) {
  const narrow = map.getContainer().clientWidth < 600;
  return narrow ? 24 : { top: 40, bottom: 40, right: 60, left: 380 };
}

export function MapView({
  styleUrl,
  states,
  selectedState,
  preview,
  tile,
  userLocation,
  onSelectState,
  onClearState,
  onSelectPoint,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);

  // Handlers are bound once; they read the latest props through refs.
  const latest = useRef({ states, selectedState, onSelectState, onClearState, onSelectPoint });
  latest.current = { states, selectedState, onSelectState, onClearState, onSelectPoint };

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: styleUrl,
      bounds: CONUS,
      fitBoundsOptions: { padding: NATIONAL_PADDING },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");

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
      for (const id of [MASK_SOURCE, SELECTED_SOURCE, LIFT_SOURCE, USER_SOURCE]) {
        map.addSource(id, { type: "geojson", data: EMPTY });
      }
      for (const layer of LAYERS) map.addLayer(layer);
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

    // Zooming in on a state opens it; zooming well out of an open state closes it.
    map.on("zoomend", (event) => {
      if ((event as { pyroAuto?: boolean }).pyroAuto) return;
      const { states: all, selectedState: selected, onSelectState: openState, onClearState: close } =
        latest.current;
      const nationalZoom = map.cameraForBounds(CONUS, { padding: NATIONAL_PADDING })?.zoom;
      if (nationalZoom === undefined) return;
      const stateZoom = selected
        ? map.cameraForBounds(geometryBounds(selected.geometry), {
            padding: framePadding(map),
            maxZoom: STATE_MAX_ZOOM,
          })?.zoom
        : null;
      if (stateZoom === undefined) return;

      const intent = resolveZoom(map.getZoom(), nationalZoom, stateZoom);
      if (intent.kind === "unfocus") {
        close();
      } else if (intent.kind === "focus") {
        // Prefer the highlighted state; fall back to the one in the middle of the view.
        const centre = map.getCenter();
        const target =
          all.find((s) => s.id === hoveredState) ?? stateContaining(all, centre.lat, centre.lng);
        if (!target) return;
        setHoveredState(null);
        openState(target.properties.fips);
      }
    });

    return () => {
      cancelAnimationFrame(animation);
      setReady(false);
      mapRef.current = null;
      map.remove();
    };
  }, [styleUrl]);

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
      map.fitBounds(CONUS, { padding: NATIONAL_PADDING }, AUTO);
      return;
    }
    set(MASK_SOURCE, {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: maskOutside(selectedState.geometry) }],
    });
    set(SELECTED_SOURCE, { type: "FeatureCollection", features: [selectedState] });
    map.fitBounds(
      geometryBounds(selectedState.geometry),
      { padding: framePadding(map), maxZoom: STATE_MAX_ZOOM },
      AUTO,
    );
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
    map.fitBounds(
      [west, south, east, north],
      { padding: framePadding(map), maxZoom: TILE_MAX_ZOOM },
      AUTO,
    );
  }, [tile, ready]);

  useEffect(() => {
    if (!ready) return;
    mapRef.current
      ?.getSource<GeoJSONSource>(USER_SOURCE)
      ?.setData(userLocation ? point(userLocation) : EMPTY);
  }, [userLocation, ready]);

  return <div ref={containerRef} className="map" data-ready={ready} />;
}
