import { and, eq, inArray, isNull } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { query } from '../../db/dbfunc.js';
import { conversationMembers, conversations, directConversations, users } from '../../db/schema.js';
import { isUniqueViolation } from '../../lib/db-errors.js';
import { AppError } from '../../lib/errors.js';

export type ConversationType = 'direct' | 'group';
export type MemberRole = 'owner' | 'admin' | 'member';

export type ConversationSummary = {
  id: string;
  type: ConversationType;
  title: string | null;
  createdBy: string;
  lastSeq: number;
  createdAt: Date;
  updatedAt: Date;
  lastReadSeq: number;
  unreadCount: number;
  lastMessage: {
    id: string;
    body: string;
    seq: number;
    senderId: string;
    createdAt: Date;
  } | null;
};

type SummaryRow = {
  id: string;
  type: ConversationType;
  title: string | null;
  createdBy: string;
  lastSeq: string;
  createdAt: Date;
  updatedAt: Date;
  lastReadSeq: string;
  unreadCount: number;
  lastMessageId: string | null;
  lastMessageBody: string | null;
  lastMessageSeq: string | null;
  lastMessageSenderId: string | null;
  lastMessageCreatedAt: Date | null;
};

export async function assertMember(conversationId: string, userId: string) {
  const member = await db.query.conversationMembers.findFirst({
    where: and(
      eq(conversationMembers.conversationId, conversationId),
      eq(conversationMembers.userId, userId),
      isNull(conversationMembers.leftAt),
    ),
  });

  if (!member) {
    throw new AppError(403, 'NOT_A_MEMBER', '你不是该会话成员');
  }

  return member;
}

export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  const rows = await query<SummaryRow>(
    `select c.id, c.type, c.title, c.created_by as "createdBy",
            c.last_seq as "lastSeq", c.created_at as "createdAt", c.updated_at as "updatedAt",
            cm.last_read_seq as "lastReadSeq",
            (select count(*)::int from messages m2
              where m2.conversation_id = c.id and m2.deleted_at is null
                and m2.seq > cm.last_read_seq and m2.sender_id <> $1) as "unreadCount",
            lm.id as "lastMessageId", lm.body as "lastMessageBody",
            lm.seq as "lastMessageSeq", lm.sender_id as "lastMessageSenderId",
            lm.created_at as "lastMessageCreatedAt"
       from conversations c
       join conversation_members cm
         on cm.conversation_id = c.id and cm.user_id = $1 and cm.left_at is null
       left join lateral (
         select m.id, m.body, m.seq, m.sender_id, m.created_at
           from messages m
          where m.conversation_id = c.id and m.deleted_at is null
          order by m.seq desc
          limit 1
       ) lm on true
      order by coalesce(lm.created_at, c.updated_at) desc`,
    [userId],
  );

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    createdBy: row.createdBy,
    lastSeq: Number(row.lastSeq),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastReadSeq: Number(row.lastReadSeq),
    unreadCount: row.unreadCount,
    lastMessage: row.lastMessageId
      ? {
          id: row.lastMessageId,
          body: row.lastMessageBody ?? '',
          seq: Number(row.lastMessageSeq ?? 0),
          senderId: row.lastMessageSenderId ?? '',
          createdAt: row.lastMessageCreatedAt ?? row.updatedAt,
        }
      : null,
  }));
}

export async function listConversationIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ conversationId: conversationMembers.conversationId })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.userId, userId), isNull(conversationMembers.leftAt)));

  return rows.map((row) => row.conversationId);
}

async function findDirect(userAId: string, userBId: string) {
  return db.query.directConversations.findFirst({
    where: and(eq(directConversations.userAId, userAId), eq(directConversations.userBId, userBId)),
  });
}

export async function createDirect(
  userId: string,
  otherUserId: string,
): Promise<{ conversationId: string; created: boolean }> {
  if (userId === otherUserId) {
    throw new AppError(400, 'INVALID_MEMBERS', '不能和自己创建私聊');
  }

  const other = await db.query.users.findFirst({
    where: and(eq(users.id, otherUserId), isNull(users.deletedAt)),
  });

  if (!other) {
    throw new AppError(404, 'USER_NOT_FOUND', '目标用户不存在');
  }

  const [userAId, userBId] = [userId, otherUserId].sort() as [string, string];
  const existing = await findDirect(userAId, userBId);

  if (existing) {
    return { conversationId: existing.conversationId, created: false };
  }

  try {
    const conversationId = await db.transaction(async (tx) => {
      const [conversation] = await tx
        .insert(conversations)
        .values({ type: 'direct', createdBy: userId })
        .returning();

      if (!conversation) {
        throw new AppError(500, 'INTERNAL_ERROR', '创建私聊失败');
      }

      await tx.insert(conversationMembers).values([
        { conversationId: conversation.id, userId, role: 'member' },
        { conversationId: conversation.id, userId: otherUserId, role: 'member' },
      ]);

      await tx.insert(directConversations).values({
        userAId,
        userBId,
        conversationId: conversation.id,
      });

      return conversation.id;
    });

    return { conversationId, created: true };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await findDirect(userAId, userBId);

      if (raced) {
        return { conversationId: raced.conversationId, created: false };
      }
    }

    throw error;
  }
}

export async function createGroup(
  userId: string,
  title: string,
  memberIds: string[],
): Promise<{ conversationId: string; created: boolean }> {
  const uniqueIds = [...new Set([userId, ...memberIds])];
  const found = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, uniqueIds), isNull(users.deletedAt)));

  if (found.length !== uniqueIds.length) {
    throw new AppError(400, 'INVALID_MEMBERS', '成员列表中存在无效用户');
  }

  const conversationId = await db.transaction(async (tx) => {
    const [conversation] = await tx
      .insert(conversations)
      .values({ type: 'group', title, createdBy: userId })
      .returning();

    if (!conversation) {
      throw new AppError(500, 'INTERNAL_ERROR', '创建群聊失败');
    }

    await tx.insert(conversationMembers).values(
      uniqueIds.map((memberId) => ({
        conversationId: conversation.id,
        userId: memberId,
        role: memberId === userId ? ('owner' as const) : ('member' as const),
      })),
    );

    return conversation.id;
  });

  return { conversationId, created: true };
}

export async function createConversation(
  userId: string,
  input: { type: ConversationType; title?: string; memberIds: string[] },
): Promise<{ conversationId: string; created: boolean }> {
  if (input.type === 'direct') {
    if (input.memberIds.length !== 1) {
      throw new AppError(400, 'INVALID_MEMBERS', '私聊必须且只能指定 1 个成员');
    }

    return createDirect(userId, input.memberIds[0]);
  }

  if (!input.title) {
    throw new AppError(400, 'TITLE_REQUIRED', '群聊必须有标题');
  }

  return createGroup(userId, input.title, input.memberIds);
}

export async function listMembers(conversationId: string, userId: string) {
  await assertMember(conversationId, userId);

  return db
    .select({
      userId: conversationMembers.userId,
      role: conversationMembers.role,
      joinedAt: conversationMembers.joinedAt,
      lastReadSeq: conversationMembers.lastReadSeq,
      username: users.username,
      displayName: users.displayName,
      email: users.email,
    })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(
      and(
        eq(conversationMembers.conversationId, conversationId),
        isNull(conversationMembers.leftAt),
      ),
    );
}

export async function addMembers(
  conversationId: string,
  actorId: string,
  userIds: string[],
): Promise<void> {
  const actor = await assertMember(conversationId, actorId);
  const conversation = await db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
  });

  if (!conversation) {
    throw new AppError(404, 'CONVERSATION_NOT_FOUND', '会话不存在');
  }

  if (conversation.type === 'direct') {
    throw new AppError(400, 'INVALID_OPERATION', '私聊不能添加成员');
  }

  if (actor.role !== 'owner' && actor.role !== 'admin') {
    throw new AppError(403, 'FORBIDDEN', '只有群主或管理员可以添加成员');
  }

  const uniqueIds = [...new Set(userIds)].filter((id) => id !== actorId);

  if (uniqueIds.length === 0) {
    return;
  }

  const found = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, uniqueIds), isNull(users.deletedAt)));

  if (found.length !== uniqueIds.length) {
    throw new AppError(400, 'INVALID_MEMBERS', '成员列表中存在无效用户');
  }

  await db
    .insert(conversationMembers)
    .values(
      uniqueIds.map((memberId) => ({
        conversationId,
        userId: memberId,
        role: 'member' as const,
      })),
    )
    .onConflictDoUpdate({
      target: [conversationMembers.conversationId, conversationMembers.userId],
      set: { leftAt: null, joinedAt: new Date() },
    });
}

export async function removeMember(
  conversationId: string,
  actorId: string,
  targetUserId: string,
): Promise<void> {
  const actor = await assertMember(conversationId, actorId);
  const conversation = await db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
  });

  if (!conversation) {
    throw new AppError(404, 'CONVERSATION_NOT_FOUND', '会话不存在');
  }

  if (conversation.type === 'direct') {
    throw new AppError(400, 'INVALID_OPERATION', '私聊不能退群');
  }

  const target = await db.query.conversationMembers.findFirst({
    where: and(
      eq(conversationMembers.conversationId, conversationId),
      eq(conversationMembers.userId, targetUserId),
      isNull(conversationMembers.leftAt),
    ),
  });

  if (!target) {
    throw new AppError(404, 'MEMBER_NOT_FOUND', '成员不存在');
  }

  if (targetUserId !== actorId && actor.role !== 'owner' && actor.role !== 'admin') {
    throw new AppError(403, 'FORBIDDEN', '只有群主或管理员可以移除成员');
  }

  if (target.role === 'owner' && targetUserId !== actorId) {
    throw new AppError(403, 'FORBIDDEN', '不能移除群主');
  }

  await db
    .update(conversationMembers)
    .set({ leftAt: new Date() })
    .where(
      and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.userId, targetUserId),
      ),
    );
}
