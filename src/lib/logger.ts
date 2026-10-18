import { pino } from 'pino';

import { env } from '../config/env.js';

const transport =
  env.NODE_ENV === 'development'
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined;

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'authorization', 'cookie'],
    censor: '[REDACTED]',
  },
  ...(transport ? { transport } : {}),
});
