import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { db } from './client.js';
import { pool } from './pool.js';

const migrationsFolder = process.env.MIGRATIONS_DIR ?? './migrations';

async function main(): Promise<void> {
  await migrate(db, { migrationsFolder });
  console.log(`数据库迁移完成：${migrationsFolder}`);
}

main()
  .then(async () => {
    await pool.end();
  })
  .catch(async (error: unknown) => {
    console.error('数据库迁移失败', error);
    await pool.end();
    process.exit(1);
  });
