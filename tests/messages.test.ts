import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bearer,
  createApp,
  createDirect,
  registerUser,
  resetDatabase,
  type TestApp,
  type TestUser,
} from './helpers.js';

let app: TestApp;
let alice: TestUser;
let bob: TestUser;
let carol: TestUser;
let conversationId: string;

beforeAll(async () => {
  app = createApp();
  await app.ready();
  await resetDatabase();
  alice = await registerUser(app, 'alice');
  bob = await registerUser(app, 'bob');
  carol = await registerUser(app, 'carol');
  conversationId = (await createDirect(app, alice.accessToken, bob.id)).conversationId;
});

afterAll(async () => {
  await app.close();
});

function send(
  token: string,
  body: string,
  clientMsgId: string,
  extra: Record<string, unknown> = {},
) {
  return app.inject({
    method: 'POST',
    url: `/conversations/${conversationId}/messages`,
    headers: bearer(token),
    payload: { body, clientMsgId, ...extra },
  });
}

function list(token: string, query = 'limit=30') {
  return app.inject({
    method: 'GET',
    url: `/conversations/${conversationId}/messages?${query}`,
    headers: bearer(token),
  });
}

describe('messages', () => {
  it('发送消息并按 clientMsgId 幂等', async () => {
    const first = await send(alice.accessToken, '第一条', 'cm-1');
    expect(first.statusCode).toBe(201);
    expect(first.json().message.seq).toBe(1);

    const again = await send(alice.accessToken, '第一条', 'cm-1');
    expect(again.statusCode).toBe(201);
    expect(again.json().message.id).toBe(first.json().message.id);
  });

  it('游标分页不重不漏且按 seq 倒序', async () => {
    for (let index = 2; index <= 6; index += 1) {
      const res = await send(alice.accessToken, `消息 ${index}`, `cm-${index}`);
      expect(res.statusCode).toBe(201);
    }

    const page1 = await list(bob.accessToken, 'limit=2');
    expect(page1.statusCode).toBe(200);
    expect(page1.json().messages).toHaveLength(2);
    expect(page1.json().messages[0].seq).toBeGreaterThan(page1.json().messages[1].seq);

    const page2 = await list(bob.accessToken, `limit=2&before=${page1.json().nextBefore}`);
    const page3 = await list(bob.accessToken, `limit=2&before=${page2.json().nextBefore}`);

    const ids = [...page1.json().messages, ...page2.json().messages, ...page3.json().messages].map(
      (message: { id: string }) => message.id,
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(6);
  });

  it('未读数与已读上报', async () => {
    const before = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: bearer(bob.accessToken),
    });
    const conversation = before
      .json()
      .conversations.find((item: { id: string }) => item.id === conversationId);
    expect(conversation.unreadCount).toBe(6);

    const read = await app.inject({
      method: 'POST',
      url: `/conversations/${conversationId}/read`,
      headers: bearer(bob.accessToken),
      payload: { seq: 6 },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().lastReadSeq).toBe(6);

    const after = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: bearer(bob.accessToken),
    });
    const updated = after
      .json()
      .conversations.find((item: { id: string }) => item.id === conversationId);
    expect(updated.unreadCount).toBe(0);
  });

  it('非成员不能读写消息', async () => {
    const read = await list(carol.accessToken);
    expect(read.statusCode).toBe(403);

    const write = await send(carol.accessToken, '越权', 'carol-1');
    expect(write.statusCode).toBe(403);
  });

  it('回复不存在的消息返回 400', async () => {
    const res = await send(alice.accessToken, '回复', 'reply-1', {
      replyToId: randomUUID(),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_REPLY');
  });

  it('只能删除自己的消息，删除后列表不返回', async () => {
    const sent = await send(alice.accessToken, '待删除', 'delete-1');
    const messageId = sent.json().message.id as string;

    const forbidden = await app.inject({
      method: 'DELETE',
      url: `/messages/${messageId}`,
      headers: bearer(bob.accessToken),
    });
    expect(forbidden.statusCode).toBe(403);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/messages/${messageId}`,
      headers: bearer(alice.accessToken),
    });
    expect(deleted.statusCode).toBe(204);

    const listed = await list(bob.accessToken, 'limit=100');
    expect(listed.json().messages.some((message: { id: string }) => message.id === messageId)).toBe(
      false,
    );
  });

  it('空消息返回 400', async () => {
    const res = await send(alice.accessToken, '', 'empty-1');

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('可以回复同一会话的消息', async () => {
    const target = await send(alice.accessToken, '被回复', 'reply-target');
    const res = await send(alice.accessToken, '回复内容', 'reply-ok', {
      replyToId: target.json().message.id,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().message.replyToId).toBe(target.json().message.id);
  });

  it('clientMsgId 不能跨会话复用', async () => {
    const otherConversation = await createDirect(app, alice.accessToken, carol.id);
    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${otherConversation.conversationId}/messages`,
      headers: bearer(alice.accessToken),
      payload: { body: '复用', clientMsgId: 'cm-1' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CLIENT_MSG_ID_CONFLICT');
  });

  it('重复删除幂等，删除不存在消息返回 404', async () => {
    const sent = await send(alice.accessToken, '重复删除', 'delete-twice');
    const messageId = sent.json().message.id as string;

    const first = await app.inject({
      method: 'DELETE',
      url: `/messages/${messageId}`,
      headers: bearer(alice.accessToken),
    });
    expect(first.statusCode).toBe(204);

    const second = await app.inject({
      method: 'DELETE',
      url: `/messages/${messageId}`,
      headers: bearer(alice.accessToken),
    });
    expect(second.statusCode).toBe(204);

    const missing = await app.inject({
      method: 'DELETE',
      url: `/messages/${randomUUID()}`,
      headers: bearer(alice.accessToken),
    });
    expect(missing.statusCode).toBe(404);
  });

  it('非成员不能上报已读', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${conversationId}/read`,
      headers: bearer(carol.accessToken),
      payload: { seq: 1 },
    });

    expect(res.statusCode).toBe(403);
  });

  it('非法分页参数返回 400', async () => {
    const res = await list(bob.accessToken, 'limit=1000');

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});
