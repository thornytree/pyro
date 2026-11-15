import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FanOutOptions } from "./fan-out/fan-out-entry.ts";
import type { LandfireVersion } from "./fan-out/types.ts";
import type { InferenceConfig } from "./inference.ts";

export type ServerConfig = {
  host: string;
  port: number;
  webOrigin: string;
  defaults: FanOutOptions;
  inference: InferenceConfig;
};

export function loadEnvironment(): void {
  // Resolves apps/orchestrator/.env from both src/ and compiled dist/.
  const path = fileURLToPath(new URL("../.env", import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function validHistoricalRange(start: string, end: string): boolean {
  return validDate(start) && validDate(end) && start >= "1980-01-01" && start <= end &&
    Date.parse(`${end}T00:00:00Z`) < Date.now() &&
    Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`) < 366 * 86400000;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const missing = ["FIRMS_MAP_KEY", "EARTHDATA_TOKEN", "DAYMET_START_DATE", "DAYMET_END_DATE"]
    .filter(name => !env[name]?.trim());
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}. Set apps/orchestrator/.env.`);
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535.");
  const forecastHours = Number(env.DEFAULT_FORECAST_HOURS ?? 24);
  if (!Number.isInteger(forecastHours) || forecastHours < 1 || forecastHours > 72) {
    throw new Error("DEFAULT_FORECAST_HOURS must be an integer between 1 and 72.");
  }
  const startDate = env.DAYMET_START_DATE!.trim();
  const endDate = env.DAYMET_END_DATE!.trim();
  if (!validHistoricalRange(startDate, endDate)) throw new Error("DAYMET_START_DATE and DAYMET_END_DATE must form a historical range of at most 366 days, starting in 1980 or later.");
  const version = env.LANDFIRE_VERSION ?? "LF2025";
  if (!["LF2020", "LF2022", "LF2023", "LF2024", "LF2025"].includes(version)) {
    throw new Error("Unsupported LANDFIRE_VERSION.");
  }
  let webOrigin: string;
  try {
    const url = new URL(env.WEB_ORIGIN ?? "http://localhost:5173");
    if (!["http:", "https:"].includes(url.protocol) || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error();
    webOrigin = url.origin;
  } catch {
    throw new Error("WEB_ORIGIN must be an HTTP(S) origin, such as http://localhost:5173.");
  }
  // Optional: without it /tiles returns observations only (status "observed").
  let inferenceUrl: string | null = null;
  if (env.INFERENCE_URL?.trim()) {
    try {
      const url = new URL(env.INFERENCE_URL.trim());
      if (!["http:", "https:"].includes(url.protocol) || url.search || url.hash || url.username || url.password) throw new Error();
      inferenceUrl = `${url.origin}${url.pathname}`.replace(/\/+$/, "");
    } catch {
      throw new Error("INFERENCE_URL must be an HTTP(S) URL without credentials or a query, such as http://127.0.0.1:8000.");
    }
  }
  const inferenceTimeoutMs = Number(env.INFERENCE_TIMEOUT_MS ?? 20000);
  if (!Number.isInteger(inferenceTimeoutMs) || inferenceTimeoutMs < 100 || inferenceTimeoutMs > 120000) {
    throw new Error("INFERENCE_TIMEOUT_MS must be an integer between 100 and 120000.");
  }
  const host = (env.HOST ?? "127.0.0.1").trim();
  if (!host) throw new Error("HOST cannot be empty.");
  return {
    host, port, webOrigin,
    defaults: { forecastHours, landfireVersion: version as LandfireVersion, daymet: { startDate, endDate } },
    inference: { url: inferenceUrl, timeoutMs: inferenceTimeoutMs },
  };
}
