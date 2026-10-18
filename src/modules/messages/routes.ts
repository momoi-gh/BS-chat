import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { parseInput } from '../../lib/validate.js';
import { requireAuth } from '../../plugins/auth.js';
import { emitToConversation } from '../../realtime/bus.js';
import * as messages from './service.js';

const sendMessageSchema = z.object({
  body: z.string().min(1).max(4000),
  clientMsgId: z.string().min(1).max(100),
  replyToId: z.uuid().optional(),
  type: z.enum(['text', 'system']).optional(),
});

const listQuerySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const readSchema = z.object({
  seq: z.number().int().nonnegative(),
});

export function messageRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>(
    '/conversations/:id/messages',
    { preHandler: requireAuth },
    async (request) => {
      const query = parseInput(listQuerySchema, request.query);

      return messages.listMessages(request.params.id, request.user.id, query);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/conversations/:id/messages',
    { preHandler: requireAuth },
    async (request, reply) => {
      const input = parseInput(sendMessageSchema, request.body);
      const message = await messages.sendMessage(request.params.id, request.user.id, input);

      emitToConversation(message.conversationId, 'message.created', { message });

      return reply.status(201).send({ message });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/conversations/:id/read',
    { preHandler: requireAuth },
    async (request) => {
      const input = parseInput(readSchema, request.body);
      const lastReadSeq = await messages.markRead(request.params.id, request.user.id, input.seq);

      emitToConversation(request.params.id, 'message.read', {
        conversationId: request.params.id,
        userId: request.user.id,
        seq: lastReadSeq,
      });

      return { lastReadSeq };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/messages/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const message = await messages.softDeleteMessage(request.params.id, request.user.id);

      emitToConversation(message.conversationId, 'message.deleted', {
        conversationId: message.conversationId,
        messageId: message.id,
      });

      return reply.status(204).send();
    },
  );
}
