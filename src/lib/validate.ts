import type { ZodType } from 'zod';

import { AppError } from './errors.js';

export function parseInput<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);

  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
      .join('; ');

    throw new AppError(400, 'VALIDATION_ERROR', detail);
  }

  return result.data;
}
