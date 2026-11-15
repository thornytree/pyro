export type DemEncoding = "terrarium" | "mapbox";

/** Elevation tiles drawn under the live heat map. */
export interface TerrainConfig {
  /** Raster DEM tile URL with `{z}`, `{x}` and `{y}` placeholders. */
  demUrl: string;
  encoding: DemEncoding;
  /** Highest zoom the DEM server has tiles for. */
  maxZoom: number;
  /** Credit line for the elevation data, shown in the panel footer. */
  attribution: string;
}

/** Aerial imagery offered as a base view under the heat-map overlay. */
export interface SatelliteConfig {
  /** Raster tile URL with `{z}`, `{x}` and `{y}` placeholders. */
  tilesUrl: string;
  /** Highest zoom the imagery server has tiles for. */
  maxZoom: number;
  /** Credit line for the imagery, shown in the panel footer. */
  attribution: string;
}

export interface AppConfig {
  orchestratorUrl: string;
  mapStyleUrl: string;
  useMock: boolean;
  /** Null when VITE_TERRAIN_DEM_URL is unset: there is no terrain view. */
  terrain: TerrainConfig | null;
  /** Null when VITE_SATELLITE_TILES_URL is unset: there is no satellite view. */
  satellite: SatelliteConfig | null;
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy apps/web/.env.example to apps/web/.env and set it.`,
    );
  }
  return value;
}

function maxZoom(env: Env, name: string): number {
  const raw = required(env, name);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 24) {
    throw new Error(`${name} must be an integer from 0 to 24, got "${raw}".`);
  }
  return value;
}

function loadTerrain(env: Env): TerrainConfig | null {
  const demUrl = env.VITE_TERRAIN_DEM_URL;
  if (!demUrl) return null;

  const encoding = required(env, "VITE_TERRAIN_DEM_ENCODING");
  if (encoding !== "terrarium" && encoding !== "mapbox") {
    throw new Error(
      `VITE_TERRAIN_DEM_ENCODING must be "terrarium" or "mapbox", got "${encoding}".`,
    );
  }
  return {
    demUrl,
    encoding,
    maxZoom: maxZoom(env, "VITE_TERRAIN_DEM_MAXZOOM"),
    attribution: required(env, "VITE_TERRAIN_ATTRIBUTION"),
  };
}

function loadSatellite(env: Env): SatelliteConfig | null {
  const tilesUrl = env.VITE_SATELLITE_TILES_URL;
  if (!tilesUrl) return null;
  return {
    tilesUrl,
    maxZoom: maxZoom(env, "VITE_SATELLITE_MAXZOOM"),
    attribution: required(env, "VITE_SATELLITE_ATTRIBUTION"),
  };
}

export function loadConfig(env: Env): AppConfig {
  const useMock = env.VITE_USE_MOCK === "true";
  return {
    // The orchestrator URL is only needed when we actually call it.
    orchestratorUrl: useMock
      ? (env.VITE_ORCHESTRATOR_URL ?? "")
      : required(env, "VITE_ORCHESTRATOR_URL").replace(/\/+$/, ""),
    mapStyleUrl: required(env, "VITE_MAP_STYLE_URL"),
    useMock,
    terrain: loadTerrain(env),
    satellite: loadSatellite(env),
  };
}
