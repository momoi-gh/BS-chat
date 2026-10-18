import { buildApp } from './app.js';
import { env } from './config/env.js';

const app = buildApp();

async function main(): Promise<void> {
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
