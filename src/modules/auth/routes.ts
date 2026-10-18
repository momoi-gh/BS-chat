import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { parseInput } from '../../lib/validate.js';
import { requireAuth } from '../../plugins/auth.js';
import * as auth from './service.js';

const registerSchema = z.object({
  email: z.string().trim().max(255).email(),
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, '只能包含字母、数字和下划线'),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(64).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().max(255).email(),
  password: z.string().min(1).max(128),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

function context(request: FastifyRequest): auth.AuthContext {
  return {
    userAgent: request.headers['user-agent'],
    ip: request.ip,
  };
}

const authRateLimit = {
  config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
};

export function authRoutes(app: FastifyInstance): void {
  app.post('/auth/register', authRateLimit, async (request, reply) => {
    const input = parseInput(registerSchema, request.body);
    const result = await auth.register(input, context(request));

    return reply.status(201).send(result);
  });

  app.post('/auth/login', authRateLimit, async (request, reply) => {
    const input = parseInput(loginSchema, request.body);
    const result = await auth.login(input, context(request));

    return reply.status(200).send(result);
  });

  app.post('/auth/refresh', authRateLimit, async (request, reply) => {
    const input = parseInput(refreshSchema, request.body);
    const result = await auth.refresh(input, context(request));

    return reply.status(200).send(result);
  });

  app.post('/auth/logout', async (request, reply) => {
    const input = parseInput(refreshSchema, request.body);
    await auth.logout(input);

    return reply.status(204).send();
  });

  app.get('/users/me', { preHandler: requireAuth }, async (request) => ({
    user: await auth.getCurrentUser(request.user.id),
  }));
}
