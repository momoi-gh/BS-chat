import { AppError } from './errors.js';

type LoggableError = {
  name: string;
  code?: string;
  message: string;
  stack?: string;
};

export function toLoggableError(error: unknown): LoggableError {
  if (error instanceof AppError) {
    return { name: error.name, code: error.code, message: error.message };
  }

  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;

    if (cause instanceof Error) {
      const code = (cause as { code?: string }).code;

      return { name: cause.name, code, message: cause.message };
    }

    return { name: error.name, message: error.message, stack: error.stack };
  }

  return { name: 'UnknownError', message: String(error) };
}
