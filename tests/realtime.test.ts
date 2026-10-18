import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as createSocket, type Socket } from 'socket.io-client';

import { buildApp } from '../src/app.js';
import { initRealtime } from '../src/realtime/index.js';
import {
  createDirect,
  registerUser,
  resetDatabase,
  type TestApp,
  type TestUser,
} from './helpers.js';

let app: TestApp;
let baseUrl: string;
let alice: TestUser;
let bob: TestUser;
let carol: TestUser;
let conversationId: string;

function connect(token: string): Socket {
  return createSocket(baseUrl, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    timeout: 3000,
  });
}

function waitConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('连接超时')), 4000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitEvent<T>(socket: Socket, event: string, timeout = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待事件超时：${event}`)), timeout);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function waitPresence(
  socket: Socket,
  userId: string,
  online: boolean,
  timeout = 5000,
): Promise<{ userId: string; online: boolean; conversationId: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待在线状态超时')), timeout);
    const handler = (data: { userId: string; online: boolean; conversationId: string }) => {
      if (data.userId === userId && data.online === online) {
        clearTimeout(timer);
        socket.off('presence.update', handler);
        resolve(data);
      }
    };
    socket.on('presence.update', handler);
  });
}

function emitAck<T>(socket: Socket, event: string, payload: unknown, timeout = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack 超时：${event}`)), timeout);
    socket.emit(event, payload, (response: T) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

beforeAll(async () => {
  app = buildApp();
  const io = initRealtime(app.server);
  app.addHook('onClose', async () => {
    await io.close();
  });
  await app.ready();
  await resetDatabase();

  alice = await registerUser(app, 'alice');
  bob = await registerUser(app, 'bob');
  carol = await registerUser(app, 'carol');
  conversationId = (await createDirect(app, alice.accessToken, bob.id)).conversationId;

  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app.close();
});

describe('realtime', () => {
  it('无效 token 拒绝连接', async () => {
    const socket = connect('invalid-token');
    const message = await new Promise<string>((resolve) => {
      socket.on('connect_error', (error: Error) => resolve(error.message));
      setTimeout(() => resolve('timeout'), 3000);
    });

    expect(message).toBe('UNAUTHORIZED');
    socket.close();
  });

  it('广播消息、typing、已读、在线状态与补拉', async () => {
    const aliceSocket = connect(alice.accessToken);
    await waitConnect(aliceSocket);
    await waitEvent(aliceSocket, 'ready');

    const presenceOnline = waitPresence(aliceSocket, bob.id, true);
    const bobSocket = connect(bob.accessToken);
    await waitConnect(bobSocket);
    await waitEvent(bobSocket, 'ready');
    await presenceOnline;

    const aliceCreated = waitEvent<{ message: { id: string; seq: number } }>(
      aliceSocket,
      'message.created',
    );
    const bobCreated = waitEvent<{ message: { id: string; seq: number } }>(
      bobSocket,
      'message.created',
    );

    const ack = await emitAck<{
      ok: boolean;
      message: { id: string; seq: number };
    }>(aliceSocket, 'message.send', {
      conversationId,
      body: 'ws 消息',
      clientMsgId: 'ws-1',
    });

    expect(ack.ok).toBe(true);
    const [aliceMessage, bobMessage] = await Promise.all([aliceCreated, bobCreated]);
    expect(aliceMessage.message.id).toBe(ack.message.id);
    expect(bobMessage.message.id).toBe(ack.message.id);

    const typing = waitEvent<{ userId: string; typing: boolean }>(aliceSocket, 'typing');
    bobSocket.emit('typing.start', { conversationId });
    expect((await typing).userId).toBe(bob.id);

    const readEvent = waitEvent<{ userId: string; seq: number }>(aliceSocket, 'message.read');
    const readAck = await emitAck<{ ok: boolean }>(bobSocket, 'message.read', {
      conversationId,
      seq: ack.message.seq,
    });
    expect(readAck.ok).toBe(true);
    expect((await readEvent).seq).toBe(ack.message.seq);

    const syncAck = await emitAck<{ ok: boolean; messages: unknown[] }>(
      aliceSocket,
      'sync.request',
      { conversationId, afterSeq: 0 },
    );
    expect(syncAck.ok).toBe(true);
    expect(syncAck.messages.length).toBeGreaterThan(0);

    const carolSocket = connect(carol.accessToken);
    await waitConnect(carolSocket);
    await waitEvent(carolSocket, 'ready');
    const denied = await emitAck<{ ok: boolean; error: { code: string } }>(
      carolSocket,
      'message.send',
      { conversationId, body: '越权', clientMsgId: 'ws-carol' },
    );
    expect(denied.ok).toBe(false);
    expect(denied.error.code).toBe('NOT_A_MEMBER');
    carolSocket.close();

    const offline = waitPresence(aliceSocket, bob.id, false);
    bobSocket.close();
    await offline;

    aliceSocket.close();
  });
});
