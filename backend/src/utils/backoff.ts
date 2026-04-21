/**
 * Exponential backoff wrapper for HTTP-like errors.
 * Retries on 429 (rate-limited) and 5xx (server error); propagates other errors immediately.
 */

export interface BackoffOptions {
  maxRetries?: number;
  initialDelayMs?: number;
}

export async function withBackoff<T>(
  fn: () => Promise<T>,
  opts: BackoffOptions = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const initialDelayMs = opts.initialDelayMs ?? 2000;
  return attempt(fn, 0, maxRetries, initialDelayMs);
}

async function attempt<T>(
  fn: () => Promise<T>,
  n: number,
  max: number,
  initialMs: number,
): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    const status =
      (err as { statusCode?: number; status?: number }).statusCode ??
      (err as { statusCode?: number; status?: number }).status;
    const retryable =
      status === 429 || (typeof status === 'number' && status >= 500);
    if (!retryable || n >= max) throw err;
    const delay = initialMs * 2 ** n;
    await new Promise((r) => setTimeout(r, delay));
    return attempt(fn, n + 1, max, initialMs);
  }
}
