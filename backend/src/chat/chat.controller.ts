/**
 * POST /chat — Server-Sent Events streaming endpoint.
 *
 * Wire format (text/event-stream):
 *   event: delta
 *   data: {"text": "<partial token>"}
 *
 *   event: done
 *   data: {"sessionId": "...", "citations": [...]}
 *
 * On error:
 *   event: error
 *   data: {"message": "..."}
 *   <connection closes without a `done` event>
 */

import { Body, Controller, Logger, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';

import { ChatRequestSchema, type ChatRequest } from './chat.dto';
import { ChatService, type ChatTurnHandle } from './chat.service';

@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private readonly chat: ChatService) {}

  @Post()
  async stream(
    @Body() body: unknown,
    @Res({ passthrough: false }) reply: FastifyReply,
  ): Promise<void> {
    // 1. Validate body.
    let parsed: ChatRequest;
    try {
      parsed = ChatRequestSchema.parse(body);
    } catch (err) {
      const msg =
        err instanceof ZodError
          ? (err.issues[0]?.message ?? 'invalid body')
          : String(err);
      reply.raw.statusCode = 400;
      reply.raw.setHeader('Content-Type', 'application/json');
      reply.raw.end(JSON.stringify({ error: msg }));
      return;
    }

    // 2. Set SSE headers before any write.
    reply.raw.statusCode = 200;
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders?.();

    // 3. Abort on client disconnect.
    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!controller.signal.aborted) {
        controller.abort(new Error('client disconnected'));
      }
    });

    // 4. Kick off the chat turn.
    let handle: ChatTurnHandle;
    try {
      handle = await this.chat.startTurn({
        sessionId: parsed.sessionId,
        message: parsed.message,
        signal: controller.signal,
      });
    } catch (err) {
      this.writeEvent(reply, 'error', {
        message: err instanceof Error ? err.message : String(err),
      });
      reply.raw.end();
      return;
    }

    // 5. Iterate textStream, write SSE deltas, accumulate for persistence.
    const chunks: string[] = [];
    try {
      for await (const delta of handle.result.textStream) {
        chunks.push(delta);
        this.writeEvent(reply, 'delta', { text: delta });
      }
      await handle.result.done;
    } catch (err) {
      if (controller.signal.aborted) {
        this.logger.debug('chat stream aborted (client disconnect)');
        return; // connection already closing; no appendTurn
      }
      this.logger.warn(
        `chat stream error: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.writeEvent(reply, 'error', { message: 'stream failed' });
      reply.raw.end();
      return;
    }

    // 6. Stream drained successfully → persist turn → emit `done`.
    try {
      const finalText = chunks.join('');
      const { citations } = await handle.complete(finalText);
      this.writeEvent(reply, 'done', {
        sessionId: handle.sessionId,
        citations,
      });
      reply.raw.end();
    } catch (err) {
      this.logger.error(
        `appendTurn failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.writeEvent(reply, 'error', { message: 'persistence failed' });
      reply.raw.end();
    }
  }

  private writeEvent(reply: FastifyReply, event: string, data: unknown): void {
    if (reply.raw.writableEnded) return;
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}
