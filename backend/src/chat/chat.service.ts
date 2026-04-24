/**
 * Chat orchestrator for POST /chat.
 *
 * Per-request pipeline:
 *   1. RetrievalService.topK — fetch top-k chunks for the user message.
 *   2. SessionService.recentMessages — load history if sessionId provided.
 *   3. PromptLoaderService.get('chat.system', …) — render the system prompt.
 *   4. Build ChatMessage[]: history + new user turn with context glued in.
 *   5. LlmClient.stream(…) — kick off the streaming response.
 *
 * Returns a `ChatTurnHandle` so the controller can iterate the stream and
 * (only on success) invoke `complete(fullText)` which persists the turn via
 * SessionService.appendTurn. Failures / aborts must not call complete().
 */

import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  APP_CONFIG,
  type AppConfig,
  type ChatConfig,
} from '@app/config/schema';
import {
  LLM_CLIENT,
  type ChatMessage,
  type LlmClient,
  type StreamResult,
} from '@app/llm/ports/llm-client.port';
import { PromptLoaderService } from '@app/prompts/prompt-loader.service';
import { RetrievalService } from '@app/retrieval/retrieval.service';
import type { RetrievalHit, TopKOpts } from '@app/retrieval/types';

import type { ResolvedCitation } from './citations.schema';
import { CitationsService } from './citations.service';
import { SessionService } from './session.service';

export interface ChatTurnInput {
  sessionId: string | undefined;
  message: string;
  signal: AbortSignal;
  /** Step 13: threaded into retrieval + LLM traces for post-hoc join. */
  correlationId?: string;
  /** Step 13: ablation toggles for retrieval (rerank/mmr). Default = full pipeline. */
  retrievalOpts?: Pick<TopKOpts, 'rerank' | 'mmr'>;
}

export interface ChatTurnHandle {
  /** Resolved session id (existing or freshly minted in complete()). */
  sessionId: string;
  /** LLM stream. Controller iterates `result.textStream` and writes SSE deltas. */
  result: StreamResult;
  /** Retrieved hits used to build the user turn. Exposed for Step-13 eval. */
  hits: RetrievalHit[];
  /**
   * Call once after the stream finishes successfully. Persists user+assistant
   * messages atomically and returns citation payload for the `done` SSE event.
   * If the stream errors or aborts, DO NOT call complete().
   */
  complete: (finalText: string) => Promise<{ citations: ResolvedCitation[] }>;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PromptLoaderService) private readonly prompts: PromptLoaderService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(RetrievalService) private readonly retrieval: RetrievalService,
    @Inject(CitationsService) private readonly citations: CitationsService,
    @Inject(LLM_CLIENT) private readonly llm: LlmClient,
  ) {}

  async startTurn(input: ChatTurnInput): Promise<ChatTurnHandle> {
    const chatCfg = this.requireChatConfig();
    const chat = input.message;

    // 1. Retrieve context for the new user message.
    const hits = await this.retrieval.topK(chat, {
      correlationId: input.correlationId,
      rerank: input.retrievalOpts?.rerank,
      mmr: input.retrievalOpts?.mmr,
    });

    // 2. Load history if sessionId provided. Unknown ids → [] (lazy create
    //    happens in appendTurn, preserving Step 10's atomicity rule).
    const history = input.sessionId
      ? this.sessions.recentMessages(input.sessionId)
      : [];

    // 3. Render the chat system prompt.
    const collectionName = this.config.file.vector?.collection ?? 'corpus';
    const systemPrompt = this.prompts.get('chat.system', {
      collectionName,
      userName: chatCfg.userName,
      refusalString: chatCfg.refusalString,
    });

    // 4. Build messages: history + current-user-with-context.
    const messages: ChatMessage[] = history.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    messages.push({
      role: 'user',
      content: buildContextUserTurn(hits, chat),
    });

    // 5. Start streaming.
    const result = this.llm.stream({
      model: chatCfg.model,
      role: 'chat',
      system: systemPrompt,
      messages,
      temperature: chatCfg.temperature,
      maxOutputTokens: chatCfg.maxOutputTokens,
      signal: input.signal,
      correlationId: input.correlationId,
    });

    // `complete` is a deferred closure. Controller calls it after stream drain.
    // Closure captures sessionId + chat text + hits; resolved session id is
    // stored on the handle via the getter below.
    let resolvedId = input.sessionId ?? '';
    const complete = async (
      finalText: string,
    ): Promise<{ citations: ResolvedCitation[] }> => {
      const citations = await this.citations.pick(finalText, hits);
      const resolved = this.sessions.appendTurn(
        input.sessionId,
        chat,
        finalText,
        citations,
      );
      resolvedId = resolved.id;
      return { citations };
    };

    this.logger.debug(
      `startTurn sid=${input.sessionId ?? '<new>'} hits=${hits.length}`,
    );

    return {
      get sessionId(): string {
        return resolvedId;
      },
      result,
      hits,
      complete,
    };
  }

  private requireChatConfig(): ChatConfig {
    const c = this.config.file.chat;
    if (!c) {
      throw new Error(
        'Missing `chat:` section in config.yaml — required for POST /chat.',
      );
    }
    return c;
  }
}

/**
 * Format retrieved chunks followed by the user's question. The chat system
 * prompt teaches the model to read `[N]` against the numbered list below,
 * so numbering is 1-indexed and stable for the lifetime of the request.
 */
function buildContextUserTurn(hits: RetrievalHit[], question: string): string {
  if (hits.length === 0) {
    return `Context:\n(no matching sources)\n\nUser question: ${question}`;
  }
  const lines = hits.map((h, i) => {
    const title = h.metadata.sourceTitle;
    const chunk = h.metadata.text;
    return `[${i + 1}] ${chunk}\n(source: ${title})`;
  });
  return `Context:\n${lines.join('\n\n')}\n\nUser question: ${question}`;
}
