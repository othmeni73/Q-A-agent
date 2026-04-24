// Jest setup: run once per worker before any specs load.
// Keep this file narrow — each line is a global test-env override.

// Disable trace-JSONL writes. Without this, every spec that exercises the
// tracing decorators would leave a backend/traces/YYYY-MM-DD.jsonl file
// behind. NODE_ENV=test already forces mock adapters (see llm.module.ts);
// this one flag disables the tracing lane in parallel.
process.env['DISABLE_TRACING'] = '1';
