/**
 * Tracing decorators that wrap any LlmClient / Embedder implementation.
 * Pure composition: inner impls stay provider-specific, this decorator
 * handles observability uniformly.
 *
 * Sink write failures NEVER propagate — tracing is observability, not
 * business-critical behaviour, and a dropped record beats a 500.
 */

import type {
  Embedder,
  EmbedOptions,
  EmbedResult,
} from '@app/llm/ports/embedder.port';
import type {
  GenerateObjectOptions,
  GenerateObjectResult,
  GenerateTextOptions,
  GenerateTextResult,
  LlmClient,
  StreamOptions,
  StreamResult,
} from '@app/llm/ports/llm-client.port';

import type { TraceRecord, TraceSink } from './tracing';

export class TracingLlmClient implements LlmClient {
  constructor(
    private readonly inner: LlmClient,
    private readonly sink: TraceSink,
  ) {}

  async generateText(opts: GenerateTextOptions): Promise<GenerateTextResult> {
    try {
      const res = await this.inner.generateText(opts);
      this.emit({
        timestamp: new Date().toISOString(),
        model: opts.model,
        role: opts.role,
        operation: 'generateText',
        usage: res.usage,
        latencyMs: res.latencyMs,
        finishReason: res.finishReason,
      });
      return res;
    } catch (err) {
      this.emitError(opts, 'generateText', err);
      throw err;
    }
  }

  async generateObject<T>(
    opts: GenerateObjectOptions<T>,
  ): Promise<GenerateObjectResult<T>> {
    try {
      const res = await this.inner.generateObject(opts);
      this.emit({
        timestamp: new Date().toISOString(),
        model: opts.model,
        role: opts.role,
        operation: 'generateObject',
        usage: res.usage,
        latencyMs: res.latencyMs,
      });
      return res;
    } catch (err) {
      this.emitError(opts, 'generateObject', err);
      throw err;
    }
  }

  stream(opts: StreamOptions): StreamResult {
    let inner: StreamResult;
    try {
      inner = this.inner.stream(opts);
    } catch (err) {
      this.emitError(opts, 'stream', err);
      throw err;
    }

    const done = inner.done.then(
      (meta) => {
        this.emit({
          timestamp: new Date().toISOString(),
          model: opts.model,
          role: opts.role,
          operation: 'stream',
          usage: meta.usage,
          latencyMs: meta.latencyMs,
          ttftMs: meta.ttftMs,
          finishReason: meta.finishReason,
        });
        return meta;
      },
      (err: unknown) => {
        this.emitError(opts, 'stream', err);
        throw err;
      },
    );
    return { textStream: inner.textStream, done };
  }

  private emit(record: TraceRecord): void {
    try {
      this.sink.write(record);
    } catch {
      // swallow — tracing must not break user-facing calls
    }
  }

  private emitError(
    opts: { model: string; role: string },
    operation: TraceRecord['operation'],
    err: unknown,
  ): void {
    const msg = err instanceof Error ? err.message : String(err);
    this.emit({
      timestamp: new Date().toISOString(),
      model: opts.model,
      role: opts.role,
      operation,
      usage: { inputTokens: 0, totalTokens: 0 },
      latencyMs: 0,
      error: msg,
    });
  }
}

export class TracingEmbedder implements Embedder {
  constructor(
    private readonly inner: Embedder,
    private readonly sink: TraceSink,
  ) {}

  async embed(opts: EmbedOptions): Promise<EmbedResult> {
    try {
      const res = await this.inner.embed(opts);
      this.emit({
        timestamp: new Date().toISOString(),
        model: opts.model,
        role: opts.role,
        operation: 'embed',
        usage: res.usage,
        latencyMs: res.latencyMs,
      });
      return res;
    } catch (err) {
      this.emitError(opts, err);
      throw err;
    }
  }

  private emit(record: TraceRecord): void {
    try {
      this.sink.write(record);
    } catch {
      // swallow
    }
  }

  private emitError(opts: { model: string; role: string }, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    this.emit({
      timestamp: new Date().toISOString(),
      model: opts.model,
      role: opts.role,
      operation: 'embed',
      usage: { inputTokens: 0, totalTokens: 0 },
      latencyMs: 0,
      error: msg,
    });
  }
}
