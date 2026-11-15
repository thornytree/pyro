import express from "express";
import type { NextFunction, Request, Response } from "express";
import { fanOutEntry } from "./fan-out/fan-out-entry.ts";
import { validHistoricalRange } from "./config.ts";
import type { ServerConfig } from "./config.ts";
import { SourceFetchError } from "./fan-out/source-error.ts";
import { predictBundle } from "./inference/client.ts";
import { toTileResponse } from "./tile-response.ts";

class RequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function queryString(req: Request, name: string, required = false): string | undefined {
  const value = req.query[name];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new RequestError(400, "INVALID_REQUEST", `${name} must be a single non-empty value.`);
  }
  return value.trim();
}

function parsePoint(req: Request) {
  const latitude = queryString(req, "lat", true)!;
  const longitude = queryString(req, "long", true)!;
  const lat = Number(latitude);
  const long = Number(longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(long) || long < -180 || long > 180) {
    throw new RequestError(400, "INVALID_COORDINATES", "lat and long must be valid finite geographic coordinates.");
  }
  // Match the web client's coarse CONUS bounds; upstream rasters determine actual data coverage.
  if (lat < 24.4 || lat > 49.4 || long < -125 || long > -66.9) {
    throw new RequestError(422, "OUTSIDE_SUPPORTED_AREA", "The selected point is outside the supported CONUS bounds.");
  }
  return { lat, long };
}

const conusFips = new Set([
  "01", "04", "05", "06", "08", "09", "10", "11", "12", "13", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "40", "41", "42", "44", "45", "46", "47", "48", "49", "50", "51", "53", "54", "55", "56",
]);

export function createApp(
  config: ServerConfig, runFanOut: typeof fanOutEntry = fanOutEntry, runInference: typeof predictBundle = predictBundle,
) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const origin = req.get("origin");
    res.vary("Origin");
    if (origin && origin !== config.webOrigin) {
      res.status(403).json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "Origin is not allowed." } });
      return;
    }
    if (origin) res.set("Access-Control-Allow-Origin", config.webOrigin);
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });

  const health = (_req: Request, res: Response) => {
    res.json({
      status: "ok", service: "pyro-orchestrator", inference: config.inference ? "configured" : "not_connected",
      regionAreaSqMiles: 300,
      sources: ["Open-Meteo", "FIRMS", "Daymet", "USGS 3DEP", "LANDFIRE"],
      defaults: config.defaults,
      endpoints: ["GET /health", "GET /tiles?lat=&long=", "GET /states/:fips/preview"],
    });
  };
  app.get("/", health);
  app.get("/health", health);

  // Historical replay uses local held-out archives; it never calls current providers.
  app.get(["/history/examples", "/history/tiles", "/history/states/:fips/preview"], async (req, res) => {
    const isExamples = req.path === "/history/examples";
    const date = isExamples ? undefined : queryString(req, "date", true);
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date >= new Date().toISOString().slice(0, 10))) {
      throw new RequestError(400, "INVALID_REQUEST", "date must be a valid past YYYY-MM-DD date.");
    }
    if (req.path.includes("/states/")) {
      if (!conusFips.has(String(req.params.fips))) throw new RequestError(404, "UNKNOWN_STATE", "Unknown state.");
      res.json({ stateId: req.params.fips, updatedAt: null, tiles: { type: "FeatureCollection", features: [] } });
      return;
    }
    const point = isExamples ? null : parsePoint(req);
    if (!config.inference) throw new RequestError(503, "HISTORY_UNAVAILABLE", "Configure INFERENCE_URL to access the historical archive.");
    const url = new URL(`${config.inference.url.replace(/\/$/, "")}${isExamples ? "/history/examples" : "/history/tiles"}`);
    if (point) { url.searchParams.set("lat", String(point.lat)); url.searchParams.set("long", String(point.long)); url.searchParams.set("date", date!); }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(config.inference.timeoutMs) });
      const body = await response.json();
      if (!response.ok) {
        res.status(response.status === 404 ? 404 : 503).json({ error: { code: "HISTORY_UNAVAILABLE", message: response.status === 404 ? "No archived samples cover this area and date. Open an available historical example." : "Historical archive is unavailable." } });
        return;
      }
      res.set("Cache-Control", "no-store").json(body);
    } catch {
      res.status(503).json({ error: { code: "HISTORY_UNAVAILABLE", message: "The historical archive service is unavailable." } });
    }
  });

  app.get("/tiles", async (req, res) => {
    const { lat, long } = parsePoint(req);
    const forecast = queryString(req, "forecastHours");
    const forecastHours = forecast === undefined ? config.defaults.forecastHours : Number(forecast);
    if (!Number.isInteger(forecastHours) || forecastHours! < 1 || forecastHours! > 72) {
      throw new RequestError(400, "INVALID_REQUEST", "forecastHours must be an integer between 1 and 72.");
    }
    const startDate = queryString(req, "daymetStart") ?? config.defaults.daymet.startDate;
    const endDate = queryString(req, "daymetEnd") ?? config.defaults.daymet.endDate;
    if (!validHistoricalRange(startDate, endDate)) {
      throw new RequestError(400, "INVALID_REQUEST", "daymetStart and daymetEnd must form a historical date range of at most 366 days.");
    }
    try {
      const bundle = await runFanOut(lat, long, {
        ...config.defaults, forecastHours, daymet: { startDate, endDate },
      });
      const tile = toTileResponse(bundle);
      res.set("Cache-Control", "no-store");
      if (!config.inference) {
        res.json({ ...tile, inference: { status: "not_configured" } });
        return;
      }
      try {
        const prediction = await runInference(bundle, config.inference.url, config.inference.timeoutMs);
        res.json({ ...tile, ...prediction, status: "ready", inference: { status: "ready" } });
      } catch {
        res.json({ ...tile, inference: {
          status: "unavailable", message: "Model inference is unavailable or rejected the forecast window. Showing source observations.",
        } });
      }
    } catch (error) {
      if (error instanceof SourceFetchError) {
        console.error(error.message); // Constructed, credential-free diagnostic.
        res.status(502).json({ error: {
          code: "SOURCE_FETCH_FAILED", source: error.source, reason: error.reason,
          upstreamStatus: error.upstreamStatus, message: error.message,
        } });
        return;
      }
      // Unknown provider exceptions may include credentials; never serialize them.
      res.status(502).json({ error: { code: "SOURCE_FETCH_FAILED", message: "A required data source failed. Check credentials, source availability and the requested dates." } });
    }
  });

  app.get("/states/:fips/preview", (req, res) => {
    const stateId = req.params.fips;
    if (typeof stateId !== "string" || !conusFips.has(stateId)) {
      throw new RequestError(404, "UNKNOWN_STATE", "Unknown or unsupported state FIPS code.");
    }
    // No model outputs exist yet. This read-only route does not start nationwide ingestion.
    res.json({ stateId, updatedAt: null, tiles: { type: "FeatureCollection", features: [] } });
  });

  app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found." } }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof RequestError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." } });
  });
  return app;
}
