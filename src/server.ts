import { buildApp } from './app.js';
import { env } from './config/env.js';
import { queryOne } from './db/dbfunc.js';
import { pool } from './db/pool.js';
import { logger } from './lib/logger.js';
import { toLoggableError } from './lib/log-error.js';
import { initRealtime } from './realtime/index.js';

const app = buildApp();
const io = initRealtime(app.server);
app.addHook('onClose', async () => {
  await io.close();
});

async function verifyDatabaseConnection(): Promise<void> {
  const row = await queryOne<{ version: string }>('select version() as version');
  const url = new URL(env.DATABASE_URL);
  const database = url.pathname.replace(/^\//, '') || '(unknown)';

  logger.info(
    {
      database: `${url.hostname}:${url.port || '5432'}/${database}`,
      version: row?.version ?? 'unknown',
    },
    'PostgreSQL 连接成功',
  );
}

async function main(): Promise<void> {
  try {
    await verifyDatabaseConnection();
    await app.listen({ port: env.PORT, host: env.HOST });
    logger.info({ url: `http://${env.HOST}:${env.PORT}` }, '服务已启动');
  } catch (error) {
    logger.error({ err: error }, '启动失败');
    logger.flush();
    process.exit(1);
  }
}

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info({ signal }, '收到退出信号，开始优雅关闭');

  try {
    await app.close();
    await pool.end();
    logger.info('已优雅关闭');
    logger.flush();
    process.exit(0);
  } catch (error) {
    logger.error({ err: toLoggableError(error) }, '关闭失败');
    logger.flush();
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

void main();
