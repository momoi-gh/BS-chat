import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bearer,
  createApp,
  loginUser,
  registerUser,
  resetDatabase,
  type TestApp,
} from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = createApp();
  await app.ready();
  await resetDatabase();
});

afterAll(async () => {
  await app.close();
});

describe('auth', () => {
  it('注册后可以访问 /users/me', async () => {
    const user = await registerUser(app, 'alice');
    const res = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: bearer(user.accessToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe(user.email);
  });

  it('重复邮箱返回 409', async () => {
    const user = await registerUser(app, 'dup');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: user.email,
        username: `dup_${Date.now()}`,
        password: 'password123',
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('USER_EXISTS');
  });

  it('错误密码返回 401', async () => {
    const user = await registerUser(app, 'wrongpw');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, password: 'wrong-password' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('刷新令牌会轮换，旧令牌不可复用', async () => {
    const user = await registerUser(app, 'refresh');
    const first = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: user.refreshToken },
    });

    expect(first.statusCode).toBe(200);
    expect(first.json().refreshToken).not.toBe(user.refreshToken);

    const reuse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: user.refreshToken },
    });

    expect(reuse.statusCode).toBe(401);
  });

  it('登出后刷新令牌失效', async () => {
    const user = await registerUser(app, 'logout');
    const refreshed = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: user.refreshToken },
    });
    const token = refreshed.json().refreshToken;

    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: { refreshToken: token },
    });
    expect(logout.statusCode).toBe(204);

    const after = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: token },
    });
    expect(after.statusCode).toBe(401);
  });

  it('缺少令牌访问受保护接口返回 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/users/me' });

    expect(res.statusCode).toBe(401);
  });

  it('登录可以拿到新令牌', async () => {
    const user = await registerUser(app, 'login');
    const logged = await loginUser(app, user.email);

    expect(logged.accessToken).toBeTruthy();
    expect(logged.id).toBe(user.id);
  });
});
