import { and, eq, isNull } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { refreshTokens, users } from '../../db/schema.js';
import { isUniqueViolation } from '../../lib/db-errors.js';
import { AppError } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import {
  hashToken,
  signAccessToken,
  signRefreshToken,
  tokenTtls,
  verifyRefreshToken,
} from '../../lib/tokens.js';

export type SafeUser = {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: Date;
};

export type AuthContext = { userAgent?: string; ip?: string };

type UserRow = typeof users.$inferSelect;

export type AuthResult = {
  user: SafeUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

function toSafeUser(user: UserRow): SafeUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
  };
}

type TokenSet = Pick<AuthResult, 'accessToken' | 'refreshToken' | 'expiresIn'>;

async function issueTokens(userId: string, context: AuthContext): Promise<TokenSet> {
  const accessToken = signAccessToken(userId);
  const refresh = signRefreshToken(userId);

  await db.insert(refreshTokens).values({
    userId,
    tokenHash: hashToken(refresh.token),
    expiresAt: refresh.expiresAt,
    userAgent: context.userAgent ?? null,
    ip: context.ip ?? null,
  });

  return {
    accessToken,
    refreshToken: refresh.token,
    expiresIn: tokenTtls.access,
  };
}

export async function register(
  input: {
    email: string;
    username: string;
    password: string;
    displayName?: string;
  },
  context: AuthContext,
): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  const username = input.username.trim();
  const passwordHash = await hashPassword(input.password);

  try {
    const [user] = await db
      .insert(users)
      .values({
        email,
        username,
        passwordHash,
        displayName: input.displayName ?? null,
      })
      .returning();

    if (!user) {
      throw new AppError(500, 'INTERNAL_ERROR', '注册失败');
    }

    return { user: toSafeUser(user), ...(await issueTokens(user.id, context)) };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(409, 'USER_EXISTS', '邮箱或用户名已被注册');
    }

    throw error;
  }
}

export async function login(
  input: { email: string; password: string },
  context: AuthContext,
): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();

  const user = await db.query.users.findFirst({
    where: and(eq(users.email, email), isNull(users.deletedAt)),
  });

  if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', '邮箱或密码错误');
  }

  return { user: toSafeUser(user), ...(await issueTokens(user.id, context)) };
}

export async function refresh(
  input: { refreshToken: string },
  context: AuthContext,
): Promise<AuthResult> {
  const payload = verifyRefreshToken(input.refreshToken);
  const tokenHash = hashToken(input.refreshToken);

  const [revoked] = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)))
    .returning();

  if (!revoked || revoked.userId !== payload.sub) {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', '刷新令牌无效或已使用');
  }

  if (revoked.expiresAt.getTime() <= Date.now()) {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', '刷新令牌已过期');
  }

  const user = await db.query.users.findFirst({
    where: and(eq(users.id, payload.sub), isNull(users.deletedAt)),
  });

  if (!user) {
    throw new AppError(401, 'UNAUTHORIZED', '用户不存在');
  }

  return { user: toSafeUser(user), ...(await issueTokens(user.id, context)) };
}

export async function logout(input: { refreshToken: string }): Promise<void> {
  const tokenHash = hashToken(input.refreshToken);

  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)));
}

export async function getCurrentUser(userId: string): Promise<SafeUser> {
  const user = await db.query.users.findFirst({
    where: and(eq(users.id, userId), isNull(users.deletedAt)),
  });

  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', '用户不存在');
  }

  return toSafeUser(user);
}
