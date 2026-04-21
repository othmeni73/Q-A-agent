import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/config.module';
import { APP_CONFIG, type AppConfig } from './config/schema';
import { buildLoggerConfig } from './config/logger.config';
import { HealthModule } from './health/health.module';
import { LlmModule } from './llm/llm.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => buildLoggerConfig(config),
    }),
    LlmModule,
    HealthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
