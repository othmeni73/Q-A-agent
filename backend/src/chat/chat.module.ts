import { Module } from '@nestjs/common';

import { RetrievalModule } from '@app/retrieval/retrieval.module';

import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { SessionService } from './session.service';

/**
 * Chat feature module. POST /chat route + orchestrator + session memory.
 *
 * Not `@Global()` — the controller is the only consumer of ChatService.
 * SessionService stays exported in case later features (eval harness, a
 * future /sessions listing route) want to inject it.
 *
 * - PersistenceModule (already @Global, Step 5) supplies repos + DATABASE.
 * - LlmModule (already @Global, Step 2) supplies LLM_CLIENT.
 * - PromptsModule (already @Global, Step 9) supplies PromptLoaderService.
 * - RetrievalModule is NOT @Global, so we import it here for RetrievalService.
 */
@Module({
  imports: [RetrievalModule],
  controllers: [ChatController],
  providers: [ChatService, SessionService],
  exports: [SessionService],
})
export class ChatModule {}
