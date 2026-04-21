import type { Params } from 'nestjs-pino';
import type { AppConfig } from './schema';

/**
 * Builds the nestjs-pino config from the composed AppConfig. Pretty
 * output in dev/test, JSON in production. Auth-bearing headers redacted.
 */
export function buildLoggerConfig(config: AppConfig): Params {
  const isDev = config.env.NODE_ENV === 'development';
  const level = config.file.log.level;

  return {
    pinoHttp: {
      level,
      transport: isDev
        ? undefined
        : {
            target: 'pino-pretty',
            options: {
              singleLine: true,
              colorize: true,
              translateTime: 'SYS:HH:MM:ss.l',
              ignore: 'pid,hostname',
            },
          },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-api-key"]',
        ],
        remove: true,
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    },
  };
}
