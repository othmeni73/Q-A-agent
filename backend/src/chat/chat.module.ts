import { Module } from '@nestjs/common';

import { SessionService } from './session.service';

/**
 * Placeholder module that currently exposes only `SessionService` (Step 10).
 * Step 11 will add `ChatController` + `ChatService` to the same module.
 *
 * Not `@Global()` — only the chat controller consumes `SessionService`, and
 * it lives in this module. PersistenceModule (already @Global, Step 5)
 * supplies the repos + DATABASE token without an explicit import here.
 */
@Module({
  providers: [SessionService],
  exports: [SessionService],
})
export class ChatModule {}
