// Generated tiles for UI work before the orchestrator implements GET /tiles.
// Deterministic per tile (and per day in historical mode), so the same click
// always renders the same data. The 0.5 degree tile grid here is a stand-in:
// the working grid is 50 km tiles in EPSG:5070 with IDs like r40c80
// (apps/orchestrator/src/fan-out/grid.ts), not yet agreed.
import type { Position } from "geojson";
import type {
  CellCollection,
  DetectionCollection,
  FirmsSource,
  LatLong,
  PerimeterCollection,
  PreviewTileCollection,
  SpreadCollection,
  StatePreview,
  StatePreviewFetcher,
  TileFetcher,
  TileResponse,
  WeatherDrivers,
} from "./types";
import { createPointTester, geometryBounds } from "../lib/geo";
import { type MapMode, LIVE, referenceTime } from "../lib/mode";
import {
  EXTREME_PROBABILITY,
  headingFromWind,
  lengthToBreadth,
  offset,
  SPREAD_HORIZONS,
  spreadEllipse,
  WIND_ADJUSTMENT,
} from "../lib/spread";
import type { StateFeature } from "../lib/states";

const TILE_DEG = 0.5;
/** 50 x 50 cells of 0.01 degrees: about 1.1 km (0.7 mi) north-south. */
export const CELLS_PER_SIDE = 50;
/** The preview tests state membership on this coarser grid, to stay fast. */
const BLOCKS_PER_SIDE = 10;
const CELLS_PER_BLOCK = CELLS_PER_SIDE / BLOCKS_PER_SIDE;
/** Single-digit-mile ceiling on how far past the extreme-risk edge the mock lets a head fire run (9 mi). */
export const MAX_HEAD_KM = 14.5;
const SOURCES: FirmsSource[] = ["MODIS", "VIIRS_SNPP", "VIIRS_NOAA20", "VIIRS_NOAA21"];
const FIRE_NAMES = ["Ridge", "Canyon", "Pine", "Juniper", "Mesa", "Creek", "Butte", "Sage"];
/** Mendeley daily perimeters: western US, 2020 to 2024 (decision 3 proof of concept). */
const PERIMETER_YEARS = [2020, 2024] as const;
const PERIMETER_MAX_LONG = -102;

/** mulberry32: small seeded PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

/** Fire season: risk peaks in August and bottoms out in February. */
function seasonalFactor(date: string): number {
  const dayOfYear =
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${date.slice(0, 4)}-01-01T00:00:00Z`)) /
    86_400_000;
  return 0.6 + 0.4 * Math.cos(((dayOfYear - 225) / 365) * 2 * Math.PI);
}

/** Probability and uncertainty for every cell of one mock tile, without geometry. */
interface Field {
  tileId: string;
  west: number;
  south: number;
  /** Row-major from the south-west corner, CELLS_PER_SIDE^2 values. */
  probability: Float64Array;
  uncertainty: Float64Array;
  hotX: number;
  hotY: number;
  peak: number;
  /** Hotspot spread in cells. */
  sigma: number;
  /** Continues the tile's random stream for detections, weather and perimeters. */
  random: () => number;
}

function buildField(row: number, col: number, mode: MapMode): Field {
  const tileId = `mock-${row}_${col}`;
  const seed = mode.kind === "live" ? tileId : `${tileId}@${mode.date}`;
  const random = prng(hash(seed));
  const season = mode.kind === "live" ? 1 : seasonalFactor(mode.date);

  // One hotspot per tile; probability falls off with distance from it.
  const hotX = random() * CELLS_PER_SIDE;
  const hotY = random() * CELLS_PER_SIDE;
  const peak = (0.35 + random() * 0.6) * season;
  const sigma = (1.5 + random() * 2.5) * CELLS_PER_BLOCK;
  const n = CELLS_PER_SIDE * CELLS_PER_SIDE;
  const probability = new Float64Array(n);
  const uncertainty = new Float64Array(n);
  const twoSigma2 = 2 * sigma * sigma;

  for (let y = 0; y < CELLS_PER_SIDE; y++) {
    for (let x = 0; x < CELLS_PER_SIDE; x++) {
      const d2 = (x + 0.5 - hotX) ** 2 + (y + 0.5 - hotY) ** 2;
      const i = y * CELLS_PER_SIDE + x;
      probability[i] = Math.min(1, peak * Math.exp(-d2 / twoSigma2) + random() * 0.03);
      uncertainty[i] = 0.1 + random() * 0.5;
    }
  }
  return {
    tileId,
    west: col * TILE_DEG,
    south: row * TILE_DEG,
    probability,
    uncertainty,
    hotX,
    hotY,
    peak,
    sigma,
    random,
  };
}

const tileIndex = ({ lat, long }: LatLong) => ({
  row: Math.floor(lat / TILE_DEG),
  col: Math.floor(long / TILE_DEG),
});

const STEP = TILE_DEG / CELLS_PER_SIDE;

/** [long, lat] of a position given in cell units within the tile. */
const cellPoint = (field: Field, x: number, y: number): Position => [
  field.west + x * STEP,
  field.south + y * STEP,
];

function buildCells(field: Field): CellCollection {
  const cells: CellCollection = { type: "FeatureCollection", features: [] };
  for (let y = 0; y < CELLS_PER_SIDE; y++) {
    for (let x = 0; x < CELLS_PER_SIDE; x++) {
      const i = y * CELLS_PER_SIDE + x;
      const w = field.west + x * STEP;
      const s = field.south + y * STEP;
      cells.features.push({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[[w, s], [w + STEP, s], [w + STEP, s + STEP], [w, s + STEP], [w, s]]],
        },
        properties: {
          probability: field.probability[i] ?? 0,
          uncertainty: field.uncertainty[i] ?? 1,
        },
      });
    }
  }
  return cells;
}

const clampToTile = (cells: number) => Math.min(CELLS_PER_SIDE - 0.01, Math.max(0.01, cells));

function buildDetections(field: Field, mode: MapMode, now: Date): DetectionCollection {
  const { random, hotX, hotY, sigma, peak } = field;
  const reference = referenceTime(mode, now);
  // Live looks back 30 h (older ones fade out); historical covers the chosen day.
  const windowHours = mode.kind === "live" ? 30 : 24;
  const detections: DetectionCollection = { type: "FeatureCollection", features: [] };
  const count = Math.round(peak * 8);
  for (let i = 0; i < count; i++) {
    const ageHours = random() * windowHours;
    detections.features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: cellPoint(
          field,
          clampToTile(hotX + (random() - 0.5) * sigma),
          clampToTile(hotY + (random() - 0.5) * sigma),
        ),
      },
      properties: {
        source: SOURCES[Math.floor(random() * SOURCES.length)] ?? "MODIS",
        acquiredAt: new Date(reference.getTime() - ageHours * 3_600_000).toISOString(),
        confidence: random(),
        frpMw: random() * 120,
      },
    });
  }
  return detections;
}

/** Mock fire-weather head rate of spread: faster with wind, slower with humid air. */
export function mockRateKmh(drivers: Pick<WeatherDrivers, "windSpeedKmh" | "relativeHumidityPct">): number {
  const dryness = (1 - drivers.relativeHumidityPct / 100) ** 2;
  return 0.15 * (1 + drivers.windSpeedKmh / 8) ** 1.3 * dryness;
}

/**
 * Spread outlines beyond the extreme-risk cells (live only). The fire is
 * taken to cover those cells already; spread starts at their downwind edge
 * and runs at a rate set by the weather, capped at MAX_HEAD_KM.
 */
function buildSpread(
  field: Field,
  now: Date,
): { spread: SpreadCollection; drivers: WeatherDrivers | null } {
  const { random } = field;
  const drivers: WeatherDrivers = {
    observedAt: new Date(now.getTime() - random() * 3_600_000).toISOString(),
    temperatureC: Math.round(18 + random() * 20),
    relativeHumidityPct: Math.round(8 + random() * 35),
    windSpeedKmh: Math.round(5 + random() * 45),
    windFromDeg: Math.round(random() * 360),
  };
  const spread: SpreadCollection = { type: "FeatureCollection", features: [] };

  const extreme: Position[] = [];
  field.probability.forEach((p, i) => {
    if (p >= EXTREME_PROBABILITY) {
      extreme.push(cellPoint(field, (i % CELLS_PER_SIDE) + 0.5, Math.floor(i / CELLS_PER_SIDE) + 0.5));
    }
  });
  if (extreme.length === 0) return { spread, drivers };

  const headingDeg = headingFromWind(drivers.windFromDeg);
  // Downwind edge: the extreme cell centre furthest along the heading, plus half a cell.
  const rad = (headingDeg * Math.PI) / 180;
  const lat0 = extreme[0]?.[1] ?? 0;
  const kmEast = 111.32 * Math.cos((lat0 * Math.PI) / 180);
  const along = ([x = 0, y = 0]: Position) => x * kmEast * Math.sin(rad) + y * 111.32 * Math.cos(rad);
  const front = extreme.reduce((best, p) => (along(p) > along(best) ? p : best));
  const origin = offset(front, headingDeg, (STEP * 111.32) / 2);
  const rateKmh = mockRateKmh(drivers);
  const lb = lengthToBreadth(drivers.windSpeedKmh * WIND_ADJUSTMENT);

  SPREAD_HORIZONS.forEach((horizonHours, i) => {
    const headKm = Math.min(MAX_HEAD_KM, rateKmh * horizonHours);
    spread.features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [spreadEllipse({ origin, headingDeg, headKm, lb })],
      },
      properties: {
        horizonHours,
        confidence: field.peak * [0.9, 0.75, 0.55][i]!,
        origin,
        headingDeg,
        rateKmh,
        headKm,
      },
    });
  });
  // Largest first, so smaller outlines draw on top.
  spread.features.reverse();
  return { spread, drivers };
}

/** Observed perimeter on the chosen day, where the mock pretends perimeter data exists. */
function buildPerimeters(field: Field, mode: MapMode & { kind: "historical" }): PerimeterCollection {
  const perimeters: PerimeterCollection = { type: "FeatureCollection", features: [] };
  const year = Number(mode.date.slice(0, 4));
  const covered =
    year >= PERIMETER_YEARS[0] &&
    year <= PERIMETER_YEARS[1] &&
    field.west + TILE_DEG <= PERIMETER_MAX_LONG;
  if (!covered || field.peak < 0.6) return perimeters;

  const { random } = field;
  const origin = cellPoint(field, field.hotX, field.hotY);
  const headKm = 2 + random() * 8;
  const lb = 1 + random() * 2.5;
  const ring = spreadEllipse({ origin, headingDeg: random() * 360, headKm, lb });
  // Area of the ellipse: semi-axes from head distance and lb.
  const root = Math.sqrt(lb * lb - 1);
  const backKm = headKm / ((lb + root) / (lb - root));
  const a = (headKm + backKm) / 2;
  perimeters.features.push({
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: {
      fireName: `${FIRE_NAMES[hash(field.tileId) % FIRE_NAMES.length]} Fire`,
      date: mode.date,
      source: "Mendeley daily perimeters (mock)",
      areaKm2: Math.round(Math.PI * a * (a / lb) * 10) / 10,
    },
  });
  return perimeters;
}

export function buildMockTile(point: LatLong, now: Date, mode: MapMode = LIVE): TileResponse {
  const { row, col } = tileIndex(point);
  const field = buildField(row, col, mode);
  const cells = buildCells(field);
  const detections = buildDetections(field, mode, now);
  const base = {
    tileId: field.tileId,
    status: "ready" as const,
    bounds: [field.west, field.south, field.west + TILE_DEG, field.south + TILE_DEG] as [
      number,
      number,
      number,
      number,
    ],
    updatedAt: now.toISOString(),
    cells,
    detections,
  };
  if (mode.kind === "historical") {
    return { ...base, perimeters: buildPerimeters(field, mode) };
  }
  return { ...base, ...buildSpread(field, now) };
}

export const mockTileFetcher: TileFetcher = async (point, mode) =>
  buildMockTile(point, new Date(), mode);

/**
 * Coarse statewide view: one square per mock tile that overlaps the state,
 * valued from the cells inside it. Built from the same fields as
 * buildMockTile, so the preview and the full tile agree. State membership is
 * tested per 5 x 5 cell block rather than per cell, to stay fast.
 */
export function buildMockStatePreview(
  state: StateFeature,
  now: Date,
  mode: MapMode = LIVE,
): StatePreview {
  const [west, south, east, north] = geometryBounds(state.geometry);
  const blockDeg = TILE_DEG / BLOCKS_PER_SIDE;
  const isInside = createPointTester(state.geometry);
  const tiles: PreviewTileCollection = { type: "FeatureCollection", features: [] };

  for (let row = Math.floor(south / TILE_DEG); row <= Math.floor(north / TILE_DEG); row++) {
    for (let col = Math.floor(west / TILE_DEG); col <= Math.floor(east / TILE_DEG); col++) {
      const tw = col * TILE_DEG;
      const ts = row * TILE_DEG;
      const blocks: boolean[] = [];
      let anyInside = false;
      for (let by = 0; by < BLOCKS_PER_SIDE; by++) {
        for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) {
          const inside = isInside(tw + (bx + 0.5) * blockDeg, ts + (by + 0.5) * blockDeg);
          blocks.push(inside);
          anyInside ||= inside;
        }
      }
      if (!anyInside) continue;

      const field = buildField(row, col, mode);
      let peak = 0;
      let uncertaintySum = 0;
      let count = 0;
      for (let y = 0; y < CELLS_PER_SIDE; y++) {
        for (let x = 0; x < CELLS_PER_SIDE; x++) {
          const block =
            Math.floor(y / CELLS_PER_BLOCK) * BLOCKS_PER_SIDE + Math.floor(x / CELLS_PER_BLOCK);
          if (!blocks[block]) continue;
          const i = y * CELLS_PER_SIDE + x;
          peak = Math.max(peak, field.probability[i] ?? 0);
          uncertaintySum += field.uncertainty[i] ?? 1;
          count++;
        }
      }

      const te = tw + TILE_DEG;
      const tn = ts + TILE_DEG;
      tiles.features.push({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[[tw, ts], [te, ts], [te, tn], [tw, tn], [tw, ts]]],
        },
        properties: {
          tileId: field.tileId,
          peakProbability: peak,
          meanUncertainty: uncertaintySum / count,
        },
      });
    }
  }

  return { stateId: state.properties.fips, updatedAt: now.toISOString(), tiles };
}

export function createMockStatePreviewFetcher(
  findState: (stateId: string) => StateFeature | undefined,
): StatePreviewFetcher {
  return async (stateId, mode) => {
    const state = findState(stateId);
    if (!state) throw new Error(`Unknown state ${stateId}`);
    return buildMockStatePreview(state, new Date(), mode);
  };
}
