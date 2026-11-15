import assert from "node:assert/strict";
import { test } from "node:test";
import { TtlCache } from "../src/cache.ts";

test("shares in-flight loads, expires entries and never keeps failures", async () => {
  let now = 1000;
  let loads = 0;
  const cache = new TtlCache<number>(100, 2, () => now);
  const load = async () => { await Promise.resolve(); return ++loads; };

  const [first, second] = await Promise.all([cache.get("a", load), cache.get("a", load)]);
  assert.deepEqual([first, second], [{ value: 1, expiresAt: 1100 }, { value: 1, expiresAt: 1100 }]);
  now = 1099;
  assert.equal((await cache.get("a", load)).value, 1);
  now = 1100;
  assert.deepEqual(await cache.get("a", load), { value: 2, expiresAt: 1200 });

  await assert.rejects(cache.get("b", async () => { throw new Error("upstream"); }), /upstream/);
  assert.equal((await cache.get("b", load)).value, 3);

  // A third key evicts the oldest entry ("a").
  await cache.get("c", load);
  assert.equal((await cache.get("a", load)).value, 5);
});

test("lets the value choose its lifetime; zero is not kept", async () => {
  let loads = 0;
  const cache = new TtlCache<{ ok: boolean }>(value => value.ok ? 1000 : 0, 4, () => 0);
  const load = (ok: boolean) => async () => { loads++; return { ok }; };
  await cache.get("k", load(false));
  await cache.get("k", load(true));
  await cache.get("k", load(true));
  assert.equal(loads, 2);
});
