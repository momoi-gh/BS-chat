import { afterAll } from 'vitest';

import pg from 'pg';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bs:bs_dev_password@127.0.0.1:5432/bs_chat_test';

const databaseUrl = new URL(process.env.DATABASE_URL);
const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ''));

if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) {
  throw new Error(`非法测试库名：${databaseName}`);
}

const adminUrl = new URL(databaseUrl);
adminUrl.pathname = '/postgres';

const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();

const exists = await admin.query('select 1 from pg_database where datname = $1', [databaseName]);

if (exists.rowCount === 0) {
  await admin.query(`create database "${databaseName}"`);
}

await admin.end();

const { db } = await import('../src/db/client.js');
const { pool } = await import('../src/db/pool.js');
const { migrate } = await import('drizzle-orm/node-postgres/migrator');

await migrate(db, { migrationsFolder: './src/db/migrations' });

afterAll(async () => {
  await pool.end();
});
