/**
 * Formatting helpers for terminal output + LLM-response sanitising.
 */

/** `"openai/gpt-oss-120b:free"` → `"gpt-oss-120b"` — terminal-friendly display name. */
export function shortName(modelId: string): string {
  const afterSlash = modelId.split('/').pop() ?? modelId;
  return afterSlash.split(':')[0];
}

/** Strip ```json``` / ``` markdown fences some models wrap around JSON output. */
export function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
  }
  return trimmed;
}
