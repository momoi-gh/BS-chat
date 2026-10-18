import { describe, expect, it } from 'vitest';

import { AppError } from '../src/lib/errors.js';
import { toLoggableError } from '../src/lib/log-error.js';

describe('toLoggableError', () => {
  it('AppError 保留 code/message，不带堆栈', () => {
    const error = new AppError(409, 'USER_EXISTS', '已存在');
    expect(toLoggableError(error)).toEqual({
      name: 'AppError',
      code: 'USER_EXISTS',
      message: '已存在',
    });
  });

  it('包装错误只取 cause 的 message/code', () => {
    const cause = Object.assign(new Error('duplicate key'), { code: '23505' });
    const wrapped = new Error('Failed query with params: secret', { cause });
    expect(toLoggableError(wrapped)).toEqual({
      name: 'Error',
      code: '23505',
      message: 'duplicate key',
    });
  });

  it('普通 Error 保留堆栈', () => {
    const error = new Error('boom');
    const logged = toLoggableError(error);
    expect(logged.message).toBe('boom');
    expect(logged.stack).toContain('boom');
  });

  it('未知值转字符串', () => {
    expect(toLoggableError('oops')).toEqual({ name: 'UnknownError', message: 'oops' });
  });
});
