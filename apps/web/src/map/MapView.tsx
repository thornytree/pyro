import { useEffect, useRef, useState } from "react";
import {
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
} from "maplibre-gl";
// MapLibre locates its worker relative to its own module URL, which a bundler
// rewrites. Hand it the bundled worker asset explicitly.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import type { LatLong, TileResponse } from "../api/types";
import { ageHours } from "../lib/age";
import { CONUS_BOUNDS } from "../lib/conus";
import { CELLS_SOURCE, DETECTIONS_SOURCE, LAYERS, TILE_SOURCE } from "./layers";

setWorkerUrl(workerUrl);

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

interface Props {
  styleUrl: string;
  tile: TileResponse | null;
  onSelect: (point: LatLong) => void;
}

function tileOutline([west, south, east, north]: TileResponse["bounds"]): FeatureCollection {
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
              [west, south],
              [east, south],
              [east, north],
              [west, north],
              [west, south],
            ],
          ],
        },
      },
    ],
  };
}

export function MapView({ styleUrl, tile, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: styleUrl,
      bounds: [CONUS_BOUNDS.west, CONUS_BOUNDS.south, CONUS_BOUNDS.east, CONUS_BOUNDS.north],
      fitBoundsOptions: { padding: 24 },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      for (const id of [CELLS_SOURCE, TILE_SOURCE, DETECTIONS_SOURCE]) {
        map.addSource(id, { type: "geojson", data: EMPTY });
      }
      for (const layer of LAYERS) map.addLayer(layer);
      setReady(true);
    });
    map.on("click", (event) => {
      onSelectRef.current({ lat: event.lngLat.lat, long: event.lngLat.lng });
    });

    return () => {
      setReady(false);
      mapRef.current = null;
      map.remove();
    };
  }, [styleUrl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const set = (id: string, data: FeatureCollection) =>
      map.getSource<GeoJSONSource>(id)?.setData(data);

    if (!tile) {
      for (const id of [CELLS_SOURCE, TILE_SOURCE, DETECTIONS_SOURCE]) set(id, EMPTY);
      return;
    }
    const now = new Date();
    set(CELLS_SOURCE, tile.cells);
    set(TILE_SOURCE, tileOutline(tile.bounds));
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
    map.fitBounds([west, south, east, north], { padding: 80, maxZoom: 9 });
  }, [tile, ready]);

  return <div ref={containerRef} className="map" data-ready={ready} />;
}
