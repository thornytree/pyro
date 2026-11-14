// US state outlines from us-atlas (US Census Bureau cartographic boundary
// files, 1:10m), limited to CONUS, which is the supported area (decision 7).
import type { Feature, FeatureCollection } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import statesTopology from "us-atlas/states-10m.json";
import type { Area } from "./geo";

export interface StateProperties {
  /** Two-digit state FIPS code, e.g. "06" for California. */
  fips: string;
  name: string;
}

/** `id` is the FIPS code as a number, which MapLibre feature-state needs. */
export type StateFeature = Feature<Area, StateProperties> & { id: number };
export type StateCollection = FeatureCollection<Area, StateProperties>;

/** Alaska, Hawaii and the territories. */
const NON_CONUS_FIPS = new Set(["02", "15", "60", "66", "69", "72", "78"]);

export function toConusStates(topology: Topology): StateFeature[] {
  const collection = feature(
    topology,
    topology.objects.states as GeometryCollection<{ name: string }>,
  );
  return collection.features
    .filter((f) => typeof f.id === "string" && !NON_CONUS_FIPS.has(f.id))
    .filter((f) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")
    .map((f): StateFeature => {
      const fips = String(f.id);
      return {
        type: "Feature",
        id: Number(fips),
        geometry: f.geometry as Area,
        properties: { fips, name: f.properties.name },
      };
    })
    .sort((a, b) => a.properties.name.localeCompare(b.properties.name));
}

let cache: StateFeature[] | null = null;

export function conusStates(): StateFeature[] {
  cache ??= toConusStates(statesTopology as unknown as Topology);
  return cache;
}
