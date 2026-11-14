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

export interface AppConfig {
  orchestratorUrl: string;
  mapStyleUrl: string;
  useMock: boolean;
  /** Null when VITE_TERRAIN_DEM_URL is unset: the tile view has no terrain. */
  terrain: TerrainConfig | null;
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

function loadTerrain(env: Env): TerrainConfig | null {
  const demUrl = env.VITE_TERRAIN_DEM_URL;
  if (!demUrl) return null;

  const encoding = required(env, "VITE_TERRAIN_DEM_ENCODING");
  if (encoding !== "terrarium" && encoding !== "mapbox") {
    throw new Error(
      `VITE_TERRAIN_DEM_ENCODING must be "terrarium" or "mapbox", got "${encoding}".`,
    );
  }
  const rawMaxZoom = required(env, "VITE_TERRAIN_DEM_MAXZOOM");
  const maxZoom = Number(rawMaxZoom);
  if (!Number.isInteger(maxZoom) || maxZoom < 0 || maxZoom > 24) {
    throw new Error(
      `VITE_TERRAIN_DEM_MAXZOOM must be an integer from 0 to 24, got "${rawMaxZoom}".`,
    );
  }
  return {
    demUrl,
    encoding,
    maxZoom,
    attribution: required(env, "VITE_TERRAIN_ATTRIBUTION"),
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
  };
}
