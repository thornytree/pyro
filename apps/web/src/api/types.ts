// Live observation contract implemented by Express. Historical/model fields remain
// optional until those backend routes exist. GeoJSON coordinates use EPSG:4326.
import type { FeatureCollection, Point, Polygon, Position } from "geojson";
import type { PredictionMetadata } from "../../../orchestrator/src/inference/client";
import type { dataBundle } from "../../../orchestrator/src/fan-out/types";
import type { MapMode } from "../lib/mode";

export type TileStatus = "ready" | "queued" | "observed";

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
  /** VIIRS categorical confidence is preserved without inventing a probability. */
  confidenceCategory?: "low" | "nominal" | "high" | null;
  /** Fire radiative power in MW. */
  frpMw: number | null;
}

export type CellCollection = FeatureCollection<Polygon, CellProperties>;
export type DetectionCollection = FeatureCollection<Point, DetectionProperties>;

/**
 * Weather behind the spread prediction, sampled at the extreme-risk area.
 * Live model output only; the observation bundle has its own regional weather grid.
 */
export interface WeatherDrivers {
  /** ISO 8601 UTC time of the weather sample. */
  observedAt: string;
  temperatureC: number;
  relativeHumidityPct: number;
  windSpeedKmh: number;
  /** Direction the wind blows FROM, degrees clockwise from north. */
  windFromDeg: number;
}

/**
 * Predicted spread from one extreme-risk area (live tiles only). One
 * feature per forecast horizon; larger horizons contain smaller ones.
 */
export interface SpreadProperties {
  /** Hours ahead of `updatedAt` this outline describes. */
  horizonHours: number;
  /** Model confidence in this outline, 0 to 1. Falls as the horizon grows. */
  confidence: number;
  /** Where the spread starts, [long, lat]: the downwind edge of the extreme-risk cells. */
  origin: Position;
  /** Direction of the head fire, degrees clockwise from north. */
  headingDeg: number;
  /** Head fire rate of spread, km/h. */
  rateKmh: number;
  /** How far the head fire runs past `origin` by this horizon, km. */
  headKm: number;
}

export type SpreadCollection = FeatureCollection<Polygon, SpreadProperties>;

/** Observed fire perimeter for one day (historical tiles only). */
export interface PerimeterProperties {
  fireName: string;
  /** UTC day the perimeter was mapped, YYYY-MM-DD. */
  date: string;
  /** Where the perimeter comes from, e.g. "Mendeley daily perimeters" or "WFIGS". */
  source: string;
  areaKm2: number;
}

export type PerimeterCollection = FeatureCollection<Polygon, PerimeterProperties>;

export interface TileResponse {
  /** Opaque region ID. Live regions cover 300 square miles around the requested point. */
  tileId: string;
  /** "observed": source data loaded, no model output. "queued": actual pending model work. */
  status: TileStatus;
  /** [west, south, east, north] in degrees. */
  bounds: [number, number, number, number];
  /** When the model output was produced; null while queued. */
  updatedAt: string | null;
  /** Required for observed live responses; absent from generated mock tiles. */
  bundle?: dataBundle;
  history?: { date: string; split: "test"; coverage: "sampled_cells_only"; weather: "retrospective_daily"; observedDetectionCount: number; message: string };
  prediction?: PredictionMetadata;
  inference?: { status: "ready" | "not_configured" | "unavailable"; message?: string };
  cells: CellCollection;
  detections: DetectionCollection;
  /** Live only: spread outlines around extreme-risk cells. Empty when no cell is extreme. */
  spread?: SpreadCollection;
  /** Live only: the weather the spread was computed from; null if none was sampled. */
  drivers?: WeatherDrivers | null;
  /** Historical only: observed perimeters on that day. Empty where no perimeter data exists. */
  perimeters?: PerimeterCollection;
}

export interface LatLong {
  lat: number;
  long: number;
}

/**
 * Live: GET /tiles triggers regional fan-out. Historical routes are proposed
 * and currently used only by mock/offline mode.
 */
export type TileFetcher = (
  point: LatLong,
  mode: MapMode,
  signal?: AbortSignal,
) => Promise<TileResponse>;

// --- State preview: Express currently returns an empty collection. -------

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
  mode: MapMode,
  signal?: AbortSignal,
) => Promise<StatePreview>;
