function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const candidate = error as { code?: unknown; cause?: unknown };

  if (typeof candidate.code === 'string') {
    return candidate.code;
  }

  return errorCode(candidate.cause);
}

export function isUniqueViolation(error: unknown): boolean {
  return errorCode(error) === '23505';
}

export function isForeignKeyViolation(error: unknown): boolean {
  return errorCode(error) === '23503';
}
