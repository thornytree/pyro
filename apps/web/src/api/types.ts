// PROPOSED contract between apps/web and apps/orchestrator. Not yet agreed:
// see "Proposed API contract" in apps/web/README.md. Geometry is GeoJSON in
// EPSG:4326 so the web app does not depend on the model grid's projection.
import type { FeatureCollection, Point, Polygon } from "geojson";

export type TileStatus = "ready" | "queued";

export type FirmsSource =
  | "MODIS"
  | "VIIRS_SNPP"
  | "VIIRS_NOAA20"
  | "VIIRS_NOAA21"
  | "LANDSAT";

export interface CellProperties {
  /** Posterior P(fire) for the cell, 0 to 1. */
  probability: number;
  /** Uncertainty of that probability, 0 (certain) to 1. */
  uncertainty: number;
}

export interface DetectionProperties {
  source: FirmsSource;
  /** ISO 8601, UTC. */
  acquiredAt: string;
  /** Unified 0 to 1 scale; null when the sensor reports none. */
  confidence: number | null;
  /** Fire radiative power in MW. */
  frpMw: number | null;
}

export type CellCollection = FeatureCollection<Polygon, CellProperties>;
export type DetectionCollection = FeatureCollection<Point, DetectionProperties>;

export interface TileResponse {
  /** Shareable ID of the 50 km tile containing the requested point. */
  tileId: string;
  /** "queued": the tile was just activated and has no model output yet. */
  status: TileStatus;
  /** [west, south, east, north] in degrees. */
  bounds: [number, number, number, number];
  /** When the model output was produced; null while queued. */
  updatedAt: string | null;
  cells: CellCollection;
  detections: DetectionCollection;
}

export interface LatLong {
  lat: number;
  long: number;
}

export type TileFetcher = (
  point: LatLong,
  signal?: AbortSignal,
) => Promise<TileResponse>;

// --- State preview (PROPOSED, see "Proposed API contract" in README) -------

export interface PreviewTileProperties {
  /** Same ID that GET /tiles returns for a point in this tile. */
  tileId: string;
  /** Highest cell probability in the tile, 0 to 1; null if the tile has no model output yet. */
  peakProbability: number | null;
  /** Mean cell uncertainty, 0 to 1; null with peakProbability. */
  meanUncertainty: number | null;
}

export type PreviewTileCollection = FeatureCollection<Polygon, PreviewTileProperties>;

export interface StatePreview {
  /** Two-digit state FIPS code. */
  stateId: string;
  /** Newest model output among the tiles; null if none have any. */
  updatedAt: string | null;
  /** One coarse cell per 50 km tile that overlaps the state. */
  tiles: PreviewTileCollection;
}

export type StatePreviewFetcher = (
  stateId: string,
  signal?: AbortSignal,
) => Promise<StatePreview>;
