/**
 * Concurrency primitives reused across scripts + production code:
 *   - Throttle: enforces a minimum gap between consecutive calls keyed by an id
 *     (per-model rate-limit compliance, external API backoff hygiene).
 *   - parallelMap: N-parallel runner that preserves input order in the result.
 */

export class Throttle {
  private lastCallAt = 0;
  constructor(private readonly minIntervalMs: number) {}

  async acquire(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, this.lastCallAt + this.minIntervalMs - now);
    if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
    this.lastCallAt = Date.now();
  }
}

const throttles = new Map<string, Throttle>();

/** Get-or-create a `Throttle` keyed by `key` with the given minimum interval. */
export function getThrottle(key: string, intervalMs: number): Throttle {
  let t = throttles.get(key);
  if (!t) {
    t = new Throttle(intervalMs);
    throttles.set(key, t);
  }
  return t;
}

/**
 * Minimal N-parallel runner. Returns results in input order.
 * Queues a new task only once the in-flight set is below `concurrency`.
 */
export async function parallelMap<I, O>(
  items: readonly I[],
  concurrency: number,
  fn: (item: I, index: number) => Promise<O>,
): Promise<O[]> {
  const results: O[] = new Array<O>(items.length);
  const executing = new Set<Promise<void>>();
  for (let i = 0; i < items.length; i++) {
    const idx = i;
    const p: Promise<void> = fn(items[idx], idx)
      .then((r) => {
        results[idx] = r;
      })
      .finally(() => {
        executing.delete(p);
      });
    executing.add(p);
    if (executing.size >= concurrency) await Promise.race(executing);
  }
  await Promise.all(executing);
  return results;
}
