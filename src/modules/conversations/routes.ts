import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { parseInput } from '../../lib/validate.js';
import { requireAuth } from '../../plugins/auth.js';
import * as conversations from './service.js';

const createConversationSchema = z.object({
  type: z.enum(['direct', 'group']),
  title: z.string().trim().min(1).max(100).optional(),
  memberIds: z.array(z.uuid()).min(1).max(100),
});

const addMembersSchema = z.object({
  userIds: z.array(z.uuid()).min(1).max(100),
});

export function conversationRoutes(app: FastifyInstance): void {
  app.get('/conversations', { preHandler: requireAuth }, async (request) => ({
    conversations: await conversations.listConversations(request.user.id),
  }));

  app.post('/conversations', { preHandler: requireAuth }, async (request, reply) => {
    const input = parseInput(createConversationSchema, request.body);
    const result = await conversations.createConversation(request.user.id, input);

    return reply.status(result.created ? 201 : 200).send(result);
  });

  app.get<{ Params: { id: string } }>(
    '/conversations/:id/members',
    { preHandler: requireAuth },
    async (request) => ({
      members: await conversations.listMembers(request.params.id, request.user.id),
    }),
  );

  app.post<{ Params: { id: string } }>(
    '/conversations/:id/members',
    { preHandler: requireAuth },
    async (request, reply) => {
      const input = parseInput(addMembersSchema, request.body);

      await conversations.addMembers(request.params.id, request.user.id, input.userIds);

      return reply.status(201).send({
        members: await conversations.listMembers(request.params.id, request.user.id),
      });
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    '/conversations/:id/members/:userId',
    { preHandler: requireAuth },
    async (request, reply) => {
      await conversations.removeMember(request.params.id, request.user.id, request.params.userId);

      return reply.status(204).send();
    },
  );
}
