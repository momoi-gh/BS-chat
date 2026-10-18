import { createHash, randomUUID } from 'node:crypto';

import jwt, { type JwtPayload } from 'jsonwebtoken';

import { env } from '../config/env.js';
import { AppError } from './errors.js';

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const ISSUER = 'bs-chat';

export type RefreshPayload = { sub: string; type: 'refresh'; jti: string };

export const tokenTtls = { access: ACCESS_TTL_SECONDS, refresh: REFRESH_TTL_SECONDS };

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId, type: 'access' }, env.JWT_SECRET, {
    expiresIn: ACCESS_TTL_SECONDS,
    issuer: ISSUER,
  });
}

export function signRefreshToken(userId: string): { token: string; expiresAt: Date } {
  const jti = randomUUID();
  const token = jwt.sign({ sub: userId, type: 'refresh', jti }, env.JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TTL_SECONDS,
    issuer: ISSUER,
  });

  return {
    token,
    expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
  };
}

export function verifyAccessToken(token: string): string {
  const payload = verify(token, env.JWT_SECRET);

  if (payload.type !== 'access' || typeof payload.sub !== 'string') {
    throw new AppError(401, 'UNAUTHORIZED', '访问令牌无效');
  }

  return payload.sub;
}

export function verifyRefreshToken(token: string): RefreshPayload {
  const payload = verify(token, env.JWT_REFRESH_SECRET);

  if (
    payload.type !== 'refresh' ||
    typeof payload.sub !== 'string' ||
    typeof payload.jti !== 'string'
  ) {
    throw new AppError(401, 'UNAUTHORIZED', '刷新令牌无效');
  }

  return { sub: payload.sub, type: 'refresh', jti: payload.jti };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function verify(token: string, secret: string): JwtPayload {
  try {
    const payload = jwt.verify(token, secret, { issuer: ISSUER });

    if (typeof payload === 'string') {
      throw new Error('unexpected payload');
    }

    return payload;
  } catch {
    throw new AppError(401, 'UNAUTHORIZED', '令牌无效或已过期');
  }
}
