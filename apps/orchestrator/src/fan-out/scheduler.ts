// Scheduled ingestion (decision 2 in docs/handover/decisions.md).
//
// - FIRMS is polled nationwide on a fixed interval, independent of users.
// - A tile becomes active when a user requests it. Weather is fetched for it
//   straight away, then refreshed hourly while it stays active.
// - A tile expires after a period with no views (default 24 hours).
//
// Everything is held in memory; a restart starts cold.

import { fetchFirmsNationwide } from "./firms.ts";
import { parseTileId } from "./grid.ts";
import { getTileWeather } from "./meteo.ts";
import type { NationalDetections, TileBundle, TileWeather } from "./types.ts";

export type IngestionOptions = {
  firmsIntervalMs?: number;
  firmsDays?: number;
  weatherIntervalMs?: number;
  tileTtlMs?: number;
  maxActiveTiles?: number;
  log?: (message: string) => void;
};

type ActiveTile = {
  activatedAt: number;
  lastViewedAt: number;
  weather: TileWeather | null;
  weatherInFlight: Promise<void> | null;
};

const MINUTE = 60_000, HOUR = 60 * MINUTE;

export class Ingestion {
  private national: NationalDetections | null = null;
  private readonly tiles = new Map<string, ActiveTile>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private readonly opts: Required<IngestionOptions>;

  constructor(options: IngestionOptions = {}) {
    this.opts = {
      firmsIntervalMs: options.firmsIntervalMs ?? 15 * MINUTE,
      firmsDays: options.firmsDays ?? 2,
      weatherIntervalMs: options.weatherIntervalMs ?? HOUR,
      tileTtlMs: options.tileTtlMs ?? 24 * HOUR,
      // Any CONUS tile can become active, so weather volume needs a cap (risks doc).
      maxActiveTiles: options.maxActiveTiles ?? 200,
      log: options.log ?? (message => console.log(`[ingestion] ${message}`)),
    };
  }

  start(): void {
    if (this.timers.length) return;
    void this.pollFirms();
    this.timers.push(
      setInterval(() => void this.pollFirms(), this.opts.firmsIntervalMs),
      setInterval(() => void this.refreshWeather(), this.opts.weatherIntervalMs),
      setInterval(() => this.expireTiles(), 10 * MINUTE),
    );
  }

  stop(): void {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  /** Mark a tile active (or keep it active) and return what is cached for it. */
  requestTile(tileId: string, now = Date.now()): TileBundle {
    parseTileId(tileId);
    let tile = this.tiles.get(tileId);
    if (!tile) {
      if (this.tiles.size >= this.opts.maxActiveTiles) this.evictLeastRecent();
      tile = { activatedAt: now, lastViewedAt: now, weather: null, weatherInFlight: null };
      this.tiles.set(tileId, tile);
      void this.fetchWeather(tileId);
    }
    tile.lastViewedAt = now;
    return this.bundle(tileId, tile);
  }

  activeTileIds(): string[] {
    return [...this.tiles.keys()];
  }

  private bundle(tileId: string, tile: ActiveTile): TileBundle {
    return {
      tile_id: tileId,
      status: tile.weather && this.national ? "ready" : "queued",
      fire: {
        fetched_at: this.national?.fetched_at ?? null,
        detections: this.national?.detections.filter(d => d.tile_id === tileId) ?? [],
      },
      weather: tile.weather,
    };
  }

  private async pollFirms(): Promise<void> {
    try {
      // The whole snapshot is replaced, which also drops real-time detections
      // that FIRMS has since superseded with NRT records.
      this.national = await fetchFirmsNationwide({ days: this.opts.firmsDays });
      this.opts.log(`FIRMS: ${this.national.detections.length} CONUS detections`);
    } catch (error) {
      // Keep the previous snapshot.
      this.opts.log(`FIRMS poll failed: ${(error as Error).message}`);
    }
  }

  private fetchWeather(tileId: string): Promise<void> {
    const tile = this.tiles.get(tileId);
    if (!tile) return Promise.resolve();
    tile.weatherInFlight ??= getTileWeather(tileId)
      .then(weather => { tile.weather = weather; })
      .catch(error => this.opts.log(`Weather for ${tileId} failed: ${(error as Error).message}`))
      .finally(() => { tile.weatherInFlight = null; });
    return tile.weatherInFlight;
  }

  private async refreshWeather(): Promise<void> {
    this.expireTiles();
    // Sequential to stay gentle on the Open-Meteo free tier.
    for (const tileId of this.tiles.keys()) await this.fetchWeather(tileId);
  }

  private expireTiles(now = Date.now()): void {
    for (const [tileId, tile] of this.tiles) {
      if (now - tile.lastViewedAt > this.opts.tileTtlMs) this.tiles.delete(tileId);
    }
  }

  private evictLeastRecent(): void {
    let oldest: string | undefined;
    let oldestAt = Infinity;
    for (const [tileId, tile] of this.tiles) {
      if (tile.lastViewedAt < oldestAt) { oldest = tileId; oldestAt = tile.lastViewedAt; }
    }
    if (oldest) this.tiles.delete(oldest);
  }
}
