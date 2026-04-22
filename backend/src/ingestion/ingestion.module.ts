import { Module } from '@nestjs/common';

import { ChunkerService } from './chunker.service';
import { ContextualPrefixService } from './contextual-prefix.service';
import { IngestEmbedderService } from './embedder.service';
import { IngestionService } from './ingestion.service';

@Module({
  providers: [
    ChunkerService,
    ContextualPrefixService,
    IngestEmbedderService,
    IngestionService,
  ],
  exports: [IngestionService, ChunkerService],
})
export class IngestionModule {}
