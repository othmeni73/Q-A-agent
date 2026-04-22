import type { ZodSchema } from 'zod';

/**
 * Role tags every LLM call with its caller. Attributed in tracing records so
 * cost/latency/tokens can be joined back to the service making the call.
 *
 * Keep this list in sync as new roles come online (see llm.module.ts).
 */
export type LlmRole =
  | 'chat'
  | 'rewriter'
  | 'prefix'
  | 'judge-pairwise'
  | 'judge-pointwise';

/** Token usage reported by the provider (bytes-to-bill). */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** Common shape carried by every LlmClient call. */
export interface BaseOptions {
  /** Fully-qualified provider model id, e.g. `'nvidia/nemotron-3-super-120b-a12b:free'`. */
  model: string;
  /** Role tag for tracing attribution. */
  role: LlmRole;
  /** Optional abort signal forwarded to the underlying provider. */
  signal?: AbortSignal;
}

export interface GenerateTextOptions extends BaseOptions {
  system?: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface GenerateTextResult {
  text: string;
  usage: Usage;
  latencyMs: number;
  finishReason: string;
}

export interface GenerateObjectOptions<T> extends BaseOptions {
  system?: string;
  prompt: string;
  schema: ZodSchema<T>;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface GenerateObjectResult<T> {
  object: T;
  usage: Usage;
  latencyMs: number;
}

/** Chat-style turn used in `stream()`. Mirrors the AI SDK's `CoreMessage` shape. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamOptions extends BaseOptions {
  system?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * Result of a streaming call.
 *
 * - `textStream` yields text deltas as they arrive.
 * - `done` resolves **after** the stream completes with the final metadata
 *   (full text, usage, TTFT, wall-clock latency, finish reason). Consumers
 *   typically do `for await (const d of res.textStream)` then `const meta = await res.done`.
 */
export interface StreamResult {
  textStream: AsyncIterable<string>;
  done: Promise<{
    text: string;
    usage: Usage;
    latencyMs: number;
    ttftMs: number;
    finishReason: string;
  }>;
}

/** The LLM chat-style client port. Real impls in `adapters/*`. */
export interface LlmClient {
  generateText(opts: GenerateTextOptions): Promise<GenerateTextResult>;
  generateObject<T>(
    opts: GenerateObjectOptions<T>,
  ): Promise<GenerateObjectResult<T>>;
  stream(opts: StreamOptions): StreamResult;
}

/** Symbol-based DI token. Safer than a string key (no collision risk). */
export const LLM_CLIENT = Symbol('LLM_CLIENT');

/**
 * Separate LlmClient bound to a different provider for the 'prefix' role.
 * Currently points at local Ollama (`gemma2:27b` — same model as the Step-2
 * benchmark judge and Step-13 eval judge). Splitting the token from LLM_CLIENT
 * lets the chat/rewrite roles keep hitting OpenRouter while ingestion runs
 * fully offline on the local 2×P6 split — zero extra API key, zero rate
 * limits, fully reproducible.
 */
export const PREFIX_LLM_CLIENT = Symbol('PREFIX_LLM_CLIENT');
