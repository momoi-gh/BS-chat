import Fastify, { type FastifyInstance } from 'fastify';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: false,
  });

  app.get('/', async () => ({
    name: 'bs-chat',
    status: 'ok',
  }));

  return app;
}
