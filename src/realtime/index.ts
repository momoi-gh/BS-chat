import type { Server as HttpServer } from 'node:http';

import { Server, type Socket } from 'socket.io';
import { z, type ZodType } from 'zod';

import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { listConversationIds } from '../modules/conversations/service.js';
import { getMessagesAfter, markRead, sendMessage } from '../modules/messages/service.js';
import { setRealtimeServer } from './bus.js';

type SocketData = { user: { id: string }; conversationIds: Set<string> };
type Ack = (response: unknown) => void;

const sendSchema = z.object({
  conversationId: z.uuid(),
  body: z.string().min(1).max(4000),
  clientMsgId: z.string().min(1).max(100),
  replyToId: z.uuid().optional(),
});

const readSchema = z.object({
  conversationId: z.uuid(),
  seq: z.number().int().nonnegative(),
});

const typingSchema = z.object({
  conversationId: z.uuid(),
});

const syncSchema = z.object({
  conversationId: z.uuid(),
  afterSeq: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(100).optional(),
});

const onlineSockets = new Map<string, Set<string>>();

function addOnline(userId: string, socketId: string): boolean {
  const sockets = onlineSockets.get(userId) ?? new Set<string>();
  sockets.add(socketId);
  onlineSockets.set(userId, sockets);

  return sockets.size === 1;
}

function removeOnline(userId: string, socketId: string): boolean {
  const sockets = onlineSockets.get(userId);

  if (!sockets) {
    return false;
  }

  sockets.delete(socketId);

  if (sockets.size === 0) {
    onlineSockets.delete(userId);

    return true;
  }

  return false;
}

function broadcastPresence(
  io: Server,
  conversationIds: string[],
  userId: string,
  online: boolean,
): void {
  for (const conversationId of conversationIds) {
    io.to(`conversation:${conversationId}`).emit('presence.update', {
      conversationId,
      userId,
      online,
    });
  }
}

function parsePayload<T>(schema: ZodType<T>, payload: unknown): T | null {
  const result = schema.safeParse(payload);

  return result.success ? result.data : null;
}

function respondError(socket: Socket, ack: Ack | undefined, error: unknown): void {
  const appError =
    error instanceof AppError ? error : new AppError(500, 'INTERNAL_ERROR', '服务器内部错误');

  ack?.({ ok: false, error: { code: appError.code, message: appError.message } });
  socket.emit('error', { code: appError.code, message: appError.message });
}

async function handleSend(
  io: Server,
  socket: Socket,
  payload: unknown,
  ack: Ack | undefined,
): Promise<void> {
  const data = socket.data as SocketData;
  const input = parsePayload(sendSchema, payload);

  if (!input) {
    return ack?.({ ok: false, error: { code: 'VALIDATION_ERROR', message: '参数不合法' } });
  }

  try {
    const message = await sendMessage(input.conversationId, data.user.id, input);

    io.to(`conversation:${input.conversationId}`).emit('message.created', { message });
    ack?.({ ok: true, message });
  } catch (error) {
    respondError(socket, ack, error);
  }
}

async function handleRead(
  io: Server,
  socket: Socket,
  payload: unknown,
  ack: Ack | undefined,
): Promise<void> {
  const data = socket.data as SocketData;
  const input = parsePayload(readSchema, payload);

  if (!input) {
    return ack?.({ ok: false, error: { code: 'VALIDATION_ERROR', message: '参数不合法' } });
  }

  try {
    const lastReadSeq = await markRead(input.conversationId, data.user.id, input.seq);

    io.to(`conversation:${input.conversationId}`).emit('message.read', {
      conversationId: input.conversationId,
      userId: data.user.id,
      seq: lastReadSeq,
    });
    ack?.({ ok: true, lastReadSeq });
  } catch (error) {
    respondError(socket, ack, error);
  }
}

function handleTyping(io: Server, socket: Socket, payload: unknown, typing: boolean): void {
  const data = socket.data as SocketData;
  const input = parsePayload(typingSchema, payload);

  if (!input || !data.conversationIds.has(input.conversationId)) {
    return;
  }

  socket.to(`conversation:${input.conversationId}`).emit('typing', {
    conversationId: input.conversationId,
    userId: data.user.id,
    typing,
  });
}

async function handleSync(socket: Socket, payload: unknown, ack: Ack | undefined): Promise<void> {
  const data = socket.data as SocketData;
  const input = parsePayload(syncSchema, payload);

  if (!input) {
    return ack?.({ ok: false, error: { code: 'VALIDATION_ERROR', message: '参数不合法' } });
  }

  try {
    const messages = await getMessagesAfter(
      input.conversationId,
      data.user.id,
      input.afterSeq,
      input.limit ?? 100,
    );

    ack?.({ ok: true, conversationId: input.conversationId, messages });
  } catch (error) {
    respondError(socket, ack, error);
  }
}

async function setupSocket(io: Server, socket: Socket): Promise<void> {
  const data = socket.data as SocketData;
  data.conversationIds = new Set();

  socket.on('message.send', (payload: unknown, ack?: Ack) => {
    void handleSend(io, socket, payload, ack);
  });

  socket.on('message.read', (payload: unknown, ack?: Ack) => {
    void handleRead(io, socket, payload, ack);
  });

  socket.on('typing.start', (payload: unknown) => {
    handleTyping(io, socket, payload, true);
  });

  socket.on('typing.stop', (payload: unknown) => {
    handleTyping(io, socket, payload, false);
  });

  socket.on('sync.request', (payload: unknown, ack?: Ack) => {
    void handleSync(socket, payload, ack);
  });

  socket.on('disconnect', () => {
    if (removeOnline(data.user.id, socket.id)) {
      broadcastPresence(io, [...data.conversationIds], data.user.id, false);
    }
  });

  const conversationIds = await listConversationIds(data.user.id);
  data.conversationIds = new Set(conversationIds);

  for (const conversationId of conversationIds) {
    await socket.join(`conversation:${conversationId}`);
  }

  if (addOnline(data.user.id, socket.id)) {
    broadcastPresence(io, conversationIds, data.user.id, true);
  }

  socket.emit('ready', { conversationIds });
}

export function initRealtime(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN.split(',').map((value) => value.trim()),
      credentials: true,
    },
    path: '/socket.io',
  });

  io.use((socket, next) => {
    try {
      const auth = socket.handshake.auth as { token?: unknown };

      if (typeof auth.token !== 'string' || auth.token.length === 0) {
        throw new AppError(401, 'UNAUTHORIZED', '缺少访问令牌');
      }

      const userId = verifyAccessToken(auth.token);
      (socket.data as SocketData).user = { id: userId };
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    void setupSocket(io, socket);
  });

  setRealtimeServer(io);

  return io;
}
