import { Global, Module } from '@nestjs/common';
import { join } from 'node:path';

import { PromptLoaderService } from './prompt-loader.service';

/**
 * Global so any feature module can inject `PromptLoaderService` without
 * re-importing this module. Pattern matches `LlmModule` (Step 2).
 */
@Global()
@Module({
  providers: [
    {
      provide: PromptLoaderService,
      useFactory: () => new PromptLoaderService(join(process.cwd(), 'prompts')),
    },
  ],
  exports: [PromptLoaderService],
})
export class PromptsModule {}
