import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '@app/config/schema';

import { FakeVectorStore } from './adapters/fake-vector-store.adapter';
import { QdrantVectorStore } from './adapters/qdrant-vector-store.adapter';
import { VECTOR_STORE, type VectorStore } from './ports/vector-store.port';

function useFakeAdapter(config: AppConfig): boolean {
  return (
    config.env.NODE_ENV === 'test' || process.env['VECTOR_ADAPTER'] === 'fake'
  );
}

@Global()
@Module({
  providers: [
    {
      provide: VECTOR_STORE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): VectorStore => {
        if (useFakeAdapter(config)) {
          return new FakeVectorStore();
        }
        const url = config.file.vector?.url ?? 'http://localhost:6333';
        return new QdrantVectorStore(url);
      },
    },
  ],
  exports: [VECTOR_STORE],
})
export class VectorModule {}
