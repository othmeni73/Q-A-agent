/**
 * LLM client factories — single home for provider client creation.
 */

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

/** OpenRouter cloud provider (used for candidate models, chat, rewriter). */
export function createOpenRouterClient(
  apiKey: string,
): ReturnType<typeof createOpenRouter> {
  return createOpenRouter({ apiKey });
}

export interface OllamaClientOptions {
  /** OpenAI-compatible base URL for the local Ollama instance (default Ollama: `http://localhost:11434/v1`). */
  baseUrl: string;
}

/**
 * Local Ollama via its OpenAI-compatible endpoint.
 * Ollama doesn't validate the API key but the adapter requires a non-empty string.
 */
export function createOllamaClient(
  opts: OllamaClientOptions,
): ReturnType<typeof createOpenAICompatible> {
  return createOpenAICompatible({
    name: 'ollama',
    baseURL: opts.baseUrl,
    apiKey: 'ollama',
  });
}
