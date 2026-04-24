import { Module } from '@nestjs/common';
import { join } from 'node:path';

import { tracingEnabled } from '@app/tracing/enabled';

import { RetrievalService } from './retrieval.service';
import {
  JsonlRetrievalTracer,
  NoopRetrievalTracer,
  RETRIEVAL_TRACER,
  type RetrievalTracer,
} from './tracing/retrieval-tracer';

@Module({
  providers: [
    RetrievalService,
    {
      provide: RETRIEVAL_TRACER,
      useFactory: (): RetrievalTracer => {
        if (!tracingEnabled()) return new NoopRetrievalTracer();
        return new JsonlRetrievalTracer(join(process.cwd(), 'traces'));
      },
    },
  ],
  exports: [RetrievalService],
})
export class RetrievalModule {}
