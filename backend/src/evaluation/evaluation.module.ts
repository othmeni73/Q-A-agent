import { Module } from '@nestjs/common';

import { ChatModule } from '@app/chat/chat.module';

import { CitationCheckService } from './citation-check.service';
import { EvaluationService } from './evaluation.service';
import { JudgeService } from './judge.service';

/**
 * Step-13 evaluation harness module. Consumed by `scripts/evaluate.ts`.
 *
 * Not @Global — only the CLI wires it. Imports ChatModule to reuse the
 * exact ChatService the HTTP route uses (same code path in prod + eval).
 * ChatService is not exported by ChatModule today, so we re-export it
 * via ChatModule's providers being available to consumers that import
 * the whole module. To ensure ChatService is injectable here, ChatModule
 * must list it in `exports` — we bump that in chat.module.ts alongside.
 */
@Module({
  imports: [ChatModule],
  providers: [EvaluationService, JudgeService, CitationCheckService],
  exports: [EvaluationService, JudgeService, CitationCheckService],
})
export class EvaluationModule {}
