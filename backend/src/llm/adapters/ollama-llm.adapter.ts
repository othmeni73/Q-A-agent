/**
 * Local-Ollama-backed `LlmClient` for the 'prefix' role and Step-13 judges.
 *
 * `generateObject` is implemented as prompt-then-parse (the judge prompts
 * already instruct "return a single JSON object on one line", and Ollama's
 * AI-SDK-OpenAI-compatible binding doesn't reliably support structured
 * outputs across models — safer to validate with Zod ourselves). `stream`
 * throws; no caller needs it.
 */

import { generateText as aiGenerateText } from 'ai';

import { createOllamaClient } from '../clients';
import type {
  GenerateObjectOptions,
  GenerateObjectResult,
  GenerateTextOptions,
  GenerateTextResult,
  LlmClient,
  StreamOptions,
  StreamResult,
  Usage,
} from '../ports/llm-client.port';

export interface OllamaLlmClientOptions {
  /** OpenAI-compatible base URL for the Ollama instance. */
  baseUrl: string;
}

export class OllamaLlmClient implements LlmClient {
  private readonly ollama: ReturnType<typeof createOllamaClient>;

  constructor(opts: OllamaLlmClientOptions) {
    this.ollama = createOllamaClient({ baseUrl: opts.baseUrl });
  }

  async generateText(opts: GenerateTextOptions): Promise<GenerateTextResult> {
    const t0 = Date.now();
    const res = await aiGenerateText({
      model: this.ollama(opts.model),
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
    const res = await aiGenerateText({
      model: this.ollama(opts.model),
      system: opts.system,
      prompt: opts.prompt,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxOutputTokens,
      abortSignal: opts.signal,
    });
    const json = extractJsonObject(res.text);
    const parsed = opts.schema.parse(json);
    return {
      object: parsed,
      usage: toUsage(res.usage),
      latencyMs: Date.now() - t0,
    };
  }

  stream(_opts: StreamOptions): StreamResult {
    throw new Error(
      'OllamaLlmClient.stream: not implemented (add when a caller needs it)',
    );
  }
}

/**
 * Extract a JSON object from free-form model output.
 * Handles the common failure modes: leading prose, trailing prose, fenced
 * code blocks. Throws if no `{…}` substring is found.
 */
function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  // Strip ```json fences if the model added them.
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      `OllamaLlmClient.generateObject: no JSON object in output: ${text.slice(0, 200)}`,
    );
  }
  const candidate = unfenced.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch (err) {
    throw new Error(
      `OllamaLlmClient.generateObject: JSON.parse failed (${
        err instanceof Error ? err.message : String(err)
      }) on: ${candidate.slice(0, 200)}`,
    );
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
