import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp, type TestApp } from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = createApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('health & security', () => {
  it('healthz 返回 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it('readyz 检查数据库', async () => {
    const res = await app.inject({ method: 'GET', url: '/readyz' });

    expect(res.statusCode).toBe(200);
    expect(res.json().database).toBe('up');
  });

  it('metrics 返回进程与连接池信息', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.statusCode).toBe(200);
    expect(typeof res.json().uptime).toBe('number');
    expect(typeof res.json().databasePool.total).toBe('number');
  });

  it('未知路由返回统一错误结构', async () => {
    const res = await app.inject({ method: 'GET', url: '/does-not-exist' });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    expect(res.json().error.requestId).toBeTruthy();
  });

  it('安全响应头与 CORS 生效', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: 'http://localhost:5173' },
    });

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('请求体超过 1MB 返回 413', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a@b.com', password: 'x'.repeat(1_100_000) },
    });

    expect(res.statusCode).toBe(413);
  });
});
