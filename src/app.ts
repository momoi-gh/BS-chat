import { randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError } from 'fastify';

import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { queryOne } from './db/dbfunc.js';
import type { AppError } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { toLoggableError } from './lib/log-error.js';
import { authRoutes } from './modules/auth/routes.js';
import { conversationRoutes } from './modules/conversations/routes.js';
import { messageRoutes } from './modules/messages/routes.js';

export function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    bodyLimit: 1024 * 1024,
  });

  app.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((value) => value.trim()),
    credentials: true,
  });

  app.register(helmet, { contentSecurityPolicy: false });

  if (env.NODE_ENV !== 'test') {
    app.register(rateLimit, {
      max: 300,
      timeWindow: '1 minute',
    });
  }

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.addHook('onResponse', async (request, reply) => {
    if (reply.elapsedTime > 500) {
      request.log.warn(
        {
          method: request.method,
          url: request.url,
          responseTime: Math.round(reply.elapsedTime),
        },
        '慢请求',
      );
    }
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `路由不存在：${request.method} ${request.url}`,
        requestId: request.id,
      },
    });
  });

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    const statusCode = error.statusCode ?? 500;

    if (statusCode >= 500) {
      request.log.error({ err: toLoggableError(error) }, '请求处理失败');
    } else {
      request.log.warn({ err: toLoggableError(error) }, '请求被拒绝');
    }

    reply.status(statusCode).send({
      error: {
        code: error.code ?? (statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR'),
        message: statusCode >= 500 ? '服务器内部错误' : error.message,
        requestId: request.id,
      },
    });
  });

  app.get('/', () => ({
    name: 'bs-chat',
    status: 'ok',
  }));

  app.get('/healthz', () => ({
    status: 'ok',
    uptime: Math.round(process.uptime()),
  }));

  app.get('/readyz', async (request, reply) => {
    try {
      await queryOne<{ ok: number }>('select 1 as ok');

      return { status: 'ready', database: 'up' };
    } catch (error) {
      request.log.error({ err: error }, '数据库健康检查失败');

      return reply.status(503).send({
        status: 'not_ready',
        database: 'down',
      });
    }
  });

  app.get('/metrics', () => ({
    uptime: Math.round(process.uptime()),
    memory: process.memoryUsage(),
    databasePool: {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    },
  }));

  app.register(authRoutes);
  app.register(conversationRoutes);
  app.register(messageRoutes);

  return app;
}
