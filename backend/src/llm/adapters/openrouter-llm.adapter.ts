/**
 * Real OpenRouter-backed implementation of the LlmClient port.
 * Wraps AI SDK's generateText / generateObject / streamText.
 *
 * Pure: no tracing, no retry, no throttling. Those concerns live in:
 *   - TracingLlmClient decorator (tracing/tracing-llm.decorator.ts)
 *   - `@app/utils/backoff` at call sites that need retry
 */

import {
  generateText as aiGenerateText,
  generateObject as aiGenerateObject,
  streamText,
} from 'ai';

import { createOpenRouterClient } from '@app/llm/clients';
import type {
  GenerateObjectOptions,
  GenerateObjectResult,
  GenerateTextOptions,
  GenerateTextResult,
  LlmClient,
  StreamOptions,
  StreamResult,
  Usage,
} from '@app/llm/ports/llm-client.port';

export class OpenRouterLlmClient implements LlmClient {
  private readonly openrouter: ReturnType<typeof createOpenRouterClient>;

  constructor(apiKey: string) {
    this.openrouter = createOpenRouterClient(apiKey);
  }

  async generateText(opts: GenerateTextOptions): Promise<GenerateTextResult> {
    const t0 = Date.now();
    const res = await aiGenerateText({
      model: this.openrouter(opts.model),
      system: opts.system,
      prompt: opts.prompt,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxOutputTokens,
      abortSignal: opts.signal,
    });
    return {
      text: res.text,
      usage: toUsage(res.usage),
      latencyMs: Date.now() - t0,
      finishReason: res.finishReason ?? 'unknown',
    };
  }

  async generateObject<T>(
    opts: GenerateObjectOptions<T>,
  ): Promise<GenerateObjectResult<T>> {
    const t0 = Date.now();
    const res = await aiGenerateObject({
      model: this.openrouter(opts.model),
      system: opts.system,
      prompt: opts.prompt,
      schema: opts.schema,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxOutputTokens,
      abortSignal: opts.signal,
    });
    return {
      object: res.object,
      usage: toUsage(res.usage),
      latencyMs: Date.now() - t0,
    };
  }

  stream(opts: StreamOptions): StreamResult {
    const t0 = Date.now();
    // Mutable shared state: timedStream writes ttftMs on first delta; done reads it.
    const state = { ttftMs: -1 };

    const result = streamText({
      model: this.openrouter(opts.model),
      system: opts.system,
      messages: opts.messages,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxOutputTokens,
      abortSignal: opts.signal,
    });

    async function* timedStream(): AsyncGenerator<string, void, unknown> {
      let first = true;
      for await (const chunk of result.textStream) {
        if (first) {
          state.ttftMs = Date.now() - t0;
          first = false;
        }
        yield chunk;
      }
    }

    const done = (async () => {
      const [text, usage, finishReason] = await Promise.all([
        result.text,
        result.usage,
        result.finishReason,
      ]);
      return {
        text,
        usage: toUsage(usage),
        latencyMs: Date.now() - t0,
        ttftMs: state.ttftMs >= 0 ? state.ttftMs : Date.now() - t0,
        finishReason: finishReason ?? 'unknown',
      };
    })();

    return { textStream: timedStream(), done };
  }
}

function toUsage(
  u:
    | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
    | undefined,
): Usage {
  const input = u?.inputTokens ?? 0;
  const output = u?.outputTokens ?? 0;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: u?.totalTokens ?? input + output,
  };
}
