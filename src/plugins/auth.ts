import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';

import { AppError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';

export function requireAuth(
  request: FastifyRequest,
  _reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  try {
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new AppError(401, 'UNAUTHORIZED', '缺少访问令牌');
    }

    request.user = { id: verifyAccessToken(header.slice('Bearer '.length)) };
    done();
  } catch (error) {
    done(error as Error);
  }
}
