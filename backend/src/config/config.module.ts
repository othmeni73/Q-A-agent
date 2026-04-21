import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from './schema';
import { loadConfig } from './load';

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: () => loadConfig(),
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
