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
let dave: TestUser;

beforeAll(async () => {
  app = createApp();
  await app.ready();
  await resetDatabase();
  alice = await registerUser(app, 'alice');
  bob = await registerUser(app, 'bob');
  carol = await registerUser(app, 'carol');
  dave = await registerUser(app, 'dave');
});

afterAll(async () => {
  await app.close();
});

describe('conversations', () => {
  it('私聊对同一对用户幂等', async () => {
    const first = await createDirect(app, alice.accessToken, bob.id);
    const second = await createDirect(app, alice.accessToken, bob.id);

    expect(first.conversationId).toBe(second.conversationId);
    expect(second.created).toBe(false);
  });

  it('创建群聊并返回成员与角色', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: bearer(alice.accessToken),
      payload: { type: 'group', title: '测试群', memberIds: [bob.id, carol.id] },
    });

    expect(res.statusCode).toBe(201);
    const conversationId = res.json().conversationId as string;

    const members = await app.inject({
      method: 'GET',
      url: `/conversations/${conversationId}/members`,
      headers: bearer(bob.accessToken),
    });

    expect(members.statusCode).toBe(200);
    expect(members.json().members).toHaveLength(3);
    const owner = members
      .json()
      .members.find((member: { userId: string }) => member.userId === alice.id);
    expect(owner.role).toBe('owner');
  });

  it('非成员不能读取会话消息', async () => {
    const direct = await createDirect(app, alice.accessToken, bob.id);
    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${direct.conversationId}/messages`,
      headers: bearer(carol.accessToken),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_A_MEMBER');
  });

  it('普通成员不能加人', async () => {
    const group = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: bearer(alice.accessToken),
      payload: { type: 'group', title: '权限群', memberIds: [bob.id] },
    });
    const conversationId = group.json().conversationId as string;

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${conversationId}/members`,
      headers: bearer(bob.accessToken),
      payload: { userIds: [dave.id] },
    });

    expect(res.statusCode).toBe(403);
  });

  it('群主可以加人和移除成员', async () => {
    const group = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: bearer(alice.accessToken),
      payload: { type: 'group', title: '成员群', memberIds: [bob.id] },
    });
    const conversationId = group.json().conversationId as string;

    const added = await app.inject({
      method: 'POST',
      url: `/conversations/${conversationId}/members`,
      headers: bearer(alice.accessToken),
      payload: { userIds: [dave.id] },
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().members).toHaveLength(3);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/conversations/${conversationId}/members/${dave.id}`,
      headers: bearer(alice.accessToken),
    });
    expect(removed.statusCode).toBe(204);

    const members = await app.inject({
      method: 'GET',
      url: `/conversations/${conversationId}/members`,
      headers: bearer(alice.accessToken),
    });
    expect(members.json().members).toHaveLength(2);
  });

  it('私聊不能加人', async () => {
    const direct = await createDirect(app, alice.accessToken, bob.id);

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${direct.conversationId}/members`,
      headers: bearer(alice.accessToken),
      payload: { userIds: [carol.id] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_OPERATION');
  });

  it('私聊不能退群', async () => {
    const direct = await createDirect(app, alice.accessToken, bob.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/conversations/${direct.conversationId}/members/${bob.id}`,
      headers: bearer(alice.accessToken),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_OPERATION');
  });

  it('群聊缺少标题返回 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: bearer(alice.accessToken),
      payload: { type: 'group', memberIds: [bob.id] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('TITLE_REQUIRED');
  });

  it('私聊成员数量不合法返回 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: bearer(alice.accessToken),
      payload: { type: 'direct', memberIds: [bob.id, carol.id] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_MEMBERS');
  });

  it('不能和自己创建私聊', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: bearer(alice.accessToken),
      payload: { type: 'direct', memberIds: [alice.id] },
    });

    expect(res.statusCode).toBe(400);
  });

  it('群聊包含无效成员返回 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: bearer(alice.accessToken),
      payload: {
        type: 'group',
        title: '无效成员群',
        memberIds: ['00000000-0000-4000-8000-000000000000'],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_MEMBERS');
  });

  it('普通成员不能移除其他成员', async () => {
    const group = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: bearer(alice.accessToken),
      payload: { type: 'group', title: '移除权限群', memberIds: [bob.id, dave.id] },
    });
    const conversationId = group.json().conversationId as string;

    const res = await app.inject({
      method: 'DELETE',
      url: `/conversations/${conversationId}/members/${dave.id}`,
      headers: bearer(bob.accessToken),
    });

    expect(res.statusCode).toBe(403);
  });

  it('移除不存在的成员返回 404', async () => {
    const group = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: bearer(alice.accessToken),
      payload: { type: 'group', title: '空成员群', memberIds: [bob.id] },
    });
    const conversationId = group.json().conversationId as string;

    const res = await app.inject({
      method: 'DELETE',
      url: `/conversations/${conversationId}/members/${'00000000-0000-4000-8000-000000000000'}`,
      headers: bearer(alice.accessToken),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('MEMBER_NOT_FOUND');
  });

  it('加人时忽略自己', async () => {
    const group = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: bearer(alice.accessToken),
      payload: { type: 'group', title: '自己群', memberIds: [bob.id] },
    });
    const conversationId = group.json().conversationId as string;

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${conversationId}/members`,
      headers: bearer(alice.accessToken),
      payload: { userIds: [alice.id] },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().members).toHaveLength(2);
  });
});
