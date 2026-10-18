import { and, asc, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { conversationMembers, conversations, messages } from '../../db/schema.js';
import { isUniqueViolation } from '../../lib/db-errors.js';
import { AppError } from '../../lib/errors.js';
import { assertMember } from '../conversations/service.js';

export type MessageType = 'text' | 'system';

export type PublicMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  seq: number;
  clientMsgId: string;
  type: MessageType;
  body: string;
  replyToId: string | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
};

export type SendMessageInput = {
  body: string;
  clientMsgId: string;
  replyToId?: string;
  type?: MessageType;
};

type MessageRow = typeof messages.$inferSelect;

export function toPublicMessage(row: MessageRow): PublicMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    seq: row.seq,
    clientMsgId: row.clientMsgId,
    type: row.type,
    body: row.body,
    replyToId: row.replyToId,
    editedAt: row.editedAt,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
  };
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  input: SendMessageInput,
): Promise<PublicMessage> {
  await assertMember(conversationId, senderId);

  const existing = await db.query.messages.findFirst({
    where: and(eq(messages.senderId, senderId), eq(messages.clientMsgId, input.clientMsgId)),
  });

  if (existing) {
    if (existing.conversationId !== conversationId) {
      throw new AppError(409, 'CLIENT_MSG_ID_CONFLICT', 'clientMsgId 已被其他会话使用');
    }

    return toPublicMessage(existing);
  }

  if (input.replyToId) {
    const reply = await db.query.messages.findFirst({
      where: and(eq(messages.id, input.replyToId), eq(messages.conversationId, conversationId)),
    });

    if (!reply) {
      throw new AppError(400, 'INVALID_REPLY', '回复的消息不存在');
    }
  }

  try {
    return await db.transaction(async (tx) => {
      const [conversation] = await tx
        .update(conversations)
        .set({
          lastSeq: sql<number>`${conversations.lastSeq} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, conversationId))
        .returning({ lastSeq: conversations.lastSeq });

      if (!conversation) {
        throw new AppError(404, 'CONVERSATION_NOT_FOUND', '会话不存在');
      }

      const [row] = await tx
        .insert(messages)
        .values({
          conversationId,
          senderId,
          seq: conversation.lastSeq,
          clientMsgId: input.clientMsgId,
          body: input.body,
          type: input.type ?? 'text',
          replyToId: input.replyToId ?? null,
        })
        .returning();

      if (!row) {
        throw new AppError(500, 'INTERNAL_ERROR', '发送消息失败');
      }

      return toPublicMessage(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const again = await db.query.messages.findFirst({
        where: and(eq(messages.senderId, senderId), eq(messages.clientMsgId, input.clientMsgId)),
      });

      if (again) {
        return toPublicMessage(again);
      }
    }

    throw error;
  }
}

export async function listMessages(
  conversationId: string,
  userId: string,
  options: { before?: number; limit: number },
): Promise<{ messages: PublicMessage[]; nextBefore: number | null }> {
  await assertMember(conversationId, userId);

  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        isNull(messages.deletedAt),
        options.before !== undefined ? lt(messages.seq, options.before) : undefined,
      ),
    )
    .orderBy(desc(messages.seq))
    .limit(options.limit);

  const lastRow = rows[rows.length - 1];
  const nextBefore = rows.length === options.limit && lastRow ? lastRow.seq : null;

  return { messages: rows.map(toPublicMessage), nextBefore };
}

export async function getMessagesAfter(
  conversationId: string,
  userId: string,
  afterSeq: number,
  limit = 100,
): Promise<PublicMessage[]> {
  await assertMember(conversationId, userId);

  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        gt(messages.seq, afterSeq),
        isNull(messages.deletedAt),
      ),
    )
    .orderBy(asc(messages.seq))
    .limit(limit);

  return rows.map(toPublicMessage);
}

export async function markRead(
  conversationId: string,
  userId: string,
  seq: number,
): Promise<number> {
  await assertMember(conversationId, userId);

  const [row] = await db
    .update(conversationMembers)
    .set({ lastReadSeq: sql<number>`greatest(${conversationMembers.lastReadSeq}, ${seq})` })
    .where(
      and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.userId, userId),
      ),
    )
    .returning({ lastReadSeq: conversationMembers.lastReadSeq });

  return row?.lastReadSeq ?? seq;
}

export async function softDeleteMessage(messageId: string, userId: string): Promise<PublicMessage> {
  const message = await db.query.messages.findFirst({ where: eq(messages.id, messageId) });

  if (!message) {
    throw new AppError(404, 'MESSAGE_NOT_FOUND', '消息不存在');
  }

  if (message.senderId !== userId) {
    throw new AppError(403, 'FORBIDDEN', '只能删除自己的消息');
  }

  if (message.deletedAt) {
    return toPublicMessage(message);
  }

  const [updated] = await db
    .update(messages)
    .set({ deletedAt: new Date() })
    .where(eq(messages.id, messageId))
    .returning();

  return toPublicMessage(updated ?? message);
}
