export type Cached<T> = { value: T; expiresAt: number };

/**
 * Small in-memory cache for provider results. Concurrent requests for one key
 * share a single load, failures are never stored, and the oldest entry is
 * dropped once `maxEntries` is reached. A restart starts cold.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { expiresAt: number; result: Promise<T> }>();

  /** `ttlMs` may depend on the value, so degraded results can expire sooner; 0 or less is not kept. */
  constructor(
    private readonly ttlMs: number | ((value: T) => number),
    private readonly maxEntries = 64,
    private readonly now: () => number = Date.now,
  ) {}

  async get(key: string, load: () => Promise<T>): Promise<Cached<T>> {
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > this.now()) {
      const value = await existing.result; // May still be in flight; its expiry is set once it settles.
      return { value, expiresAt: existing.expiresAt };
    }
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    // In flight: held until it settles, when the real expiry is known.
    const entry = { expiresAt: Infinity, result: load() };
    this.entries.set(key, entry);
    try {
      const value = await entry.result;
      const ttl = typeof this.ttlMs === "function" ? this.ttlMs(value) : this.ttlMs;
      entry.expiresAt = this.now() + ttl;
      if (ttl <= 0 && this.entries.get(key) === entry) this.entries.delete(key);
      return { value, expiresAt: entry.expiresAt };
    } catch (error) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    }
  }

  clear(): void { this.entries.clear(); }
}
