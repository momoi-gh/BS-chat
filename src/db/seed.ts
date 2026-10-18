import argon2 from 'argon2';
import { and, eq } from 'drizzle-orm';

import { db } from './client.js';
import { pool } from './pool.js';
import { conversations, users } from './schema.js';
import { createDirect, createGroup } from '../modules/conversations/service.js';
import { sendMessage } from '../modules/messages/service.js';

const SEED_PASSWORD = 'password123';

async function ensureUser(email: string, username: string, displayName: string) {
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });

  if (existing) {
    return existing;
  }

  const passwordHash = await argon2.hash(SEED_PASSWORD, { type: argon2.argon2id });
  const [created] = await db
    .insert(users)
    .values({ email, username, passwordHash, displayName })
    .returning();

  if (!created) {
    throw new Error(`创建种子用户失败：${email}`);
  }

  return created;
}

async function main(): Promise<void> {
  const alice = await ensureUser('alice@example.com', 'alice', 'Alice');
  const bob = await ensureUser('bob@example.com', 'bob', 'Bob');
  const carol = await ensureUser('carol@example.com', 'carol', 'Carol');

  const direct = await createDirect(alice.id, bob.id);
  const existingGroup = await db.query.conversations.findFirst({
    where: and(eq(conversations.type, 'group'), eq(conversations.title, 'Seed Group')),
  });
  const groupId =
    existingGroup?.id ??
    (await createGroup(alice.id, 'Seed Group', [bob.id, carol.id])).conversationId;

  await sendMessage(direct.conversationId, alice.id, {
    body: '你好 Bob，这是种子消息。',
    clientMsgId: 'seed-direct-1',
  });
  await sendMessage(direct.conversationId, bob.id, {
    body: '你好 Alice，收到。',
    clientMsgId: 'seed-direct-2',
  });
  await sendMessage(groupId, carol.id, {
    body: '群聊种子消息',
    clientMsgId: 'seed-group-1',
  });

  console.log('seed 完成');
  console.log(`direct conversation: ${direct.conversationId}`);
  console.log(`group conversation: ${groupId}`);
  console.log(`users: alice / bob / carol，密码：${SEED_PASSWORD}`);
}

main()
  .then(async () => {
    await pool.end();
  })
  .catch(async (error: unknown) => {
    console.error('seed 失败', error);
    await pool.end();
    process.exit(1);
  });
