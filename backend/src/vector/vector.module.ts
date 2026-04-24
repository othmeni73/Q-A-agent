import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '@app/config/schema';

import { FakeVectorStore } from './adapters/fake-vector-store.adapter';
import { QdrantVectorStore } from './adapters/qdrant-vector-store.adapter';
import { VECTOR_STORE, type VectorStore } from './ports/vector-store.port';

function useFakeAdapter(config: AppConfig): boolean {
  // Symmetric with LlmModule.useMockAdapter — explicit 'real'/'fake' wins
  // over the NODE_ENV=test default. The eval harness sets VECTOR_ADAPTER=real
  // (NODE_ENV=test is already set for :memory: SQLite).
  const explicit = process.env['VECTOR_ADAPTER'];
  if (explicit === 'fake') return true;
  if (explicit === 'real') return false;
  return config.env.NODE_ENV === 'test';
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
