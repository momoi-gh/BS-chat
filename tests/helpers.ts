import { sql } from 'drizzle-orm';

import { buildApp } from '../src/app.js';
import { db } from '../src/db/client.js';

export type TestApp = ReturnType<typeof buildApp>;

export type TestUser = {
  id: string;
  email: string;
  username: string;
  accessToken: string;
  refreshToken: string;
};

export function createApp(): TestApp {
  return buildApp();
}

export async function resetDatabase(): Promise<void> {
  await db.execute(
    sql`truncate table users, conversations, direct_conversations, messages, conversation_members, refresh_tokens restart identity cascade`,
  );
}

export function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

export async function registerUser(app: TestApp, name: string): Promise<TestUser> {
  const suffix = `${name}_${Math.random().toString(36).slice(2, 10)}`;
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      email: `${suffix}@test.local`,
      username: suffix,
      password: 'password123',
      displayName: name,
    },
  });

  if (res.statusCode !== 201) {
    throw new Error(`注册测试用户失败：${res.statusCode} ${res.body}`);
  }

  return toTestUser(res.json());
}

export async function loginUser(
  app: TestApp,
  email: string,
  password = 'password123',
): Promise<TestUser> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });

  if (res.statusCode !== 200) {
    throw new Error(`登录测试用户失败：${res.statusCode} ${res.body}`);
  }

  return toTestUser(res.json());
}

function toTestUser(body: {
  user: { id: string; email: string; username: string };
  accessToken: string;
  refreshToken: string;
}): TestUser {
  return {
    id: body.user.id,
    email: body.user.email,
    username: body.user.username,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
  };
}

export async function createDirect(
  app: TestApp,
  token: string,
  otherUserId: string,
): Promise<{ conversationId: string; created: boolean }> {
  const res = await app.inject({
    method: 'POST',
    url: '/conversations',
    headers: bearer(token),
    payload: { type: 'direct', memberIds: [otherUserId] },
  });

  if (res.statusCode !== 200 && res.statusCode !== 201) {
    throw new Error(`创建私聊失败：${res.statusCode} ${res.body}`);
  }

  return res.json();
}
