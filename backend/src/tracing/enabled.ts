/**
 * Single source of truth for "should we emit trace records?". Both
 * JsonlTraceSink (Step 3, LLM lane) and JsonlRetrievalTracer (Step 13,
 * retrieval lane) gate their factories on this predicate.
 *
 * Off switch: DISABLE_TRACING=1 in env. Default: on. Opt-out, not opt-in:
 * forgetting to flip a flag should give you more data, not less.
 *
 * Decoupling rationale: NODE_ENV=test controls PersistenceModule's :memory:
 * SQLite swap. The eval harness wants that swap AND real tracing for per-case
 * cost/latency. One shared flag would force eval to pick one or the other.
 */
export function tracingEnabled(): boolean {
  return process.env['DISABLE_TRACING'] !== '1';
}
