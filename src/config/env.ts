import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'postgres:' || url.protocol === 'postgresql:';
  } catch {
    return false;
  }
}

const envFile = resolve(process.cwd(), '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string({ error: 'HOST 必须是字符串' }).min(1, 'HOST 不能为空').default('127.0.0.1'),
  PORT: z.coerce
    .number({ error: 'PORT 必须是数字' })
    .int('PORT 必须是整数')
    .min(1024, 'PORT 不能小于 1024（rootless 容器限制）')
    .max(65535, 'PORT 不能大于 65535')
    .default(3000),
  DATABASE_URL: z
    .string({ error: '缺少 DATABASE_URL' })
    .refine(isPostgresUrl, '必须是 postgres:// 或 postgresql:// 连接串'),
  JWT_SECRET: z
    .string({ error: '缺少 JWT_SECRET（可用 openssl rand -hex 32 生成）' })
    .min(32, 'JWT_SECRET 至少 32 个字符'),
  JWT_REFRESH_SECRET: z
    .string({ error: '缺少 JWT_REFRESH_SECRET（可用 openssl rand -hex 32 生成）' })
    .min(32, 'JWT_REFRESH_SECRET 至少 32 个字符'),
  CORS_ORIGIN: z
    .string({ error: 'CORS_ORIGIN 必须是字符串' })
    .min(1, 'CORS_ORIGIN 不能为空')
    .default('http://localhost:5173'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'], {
      error: 'LOG_LEVEL 只能是 fatal/error/warn/info/debug/trace/silent',
    })
    .default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((issue) => {
    const key = issue.path.join('.') || '(root)';
    return `  - ${key}: ${issue.message}`;
  });

  console.error(`环境变量校验失败：\n${lines.join('\n')}`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
