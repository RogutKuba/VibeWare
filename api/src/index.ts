import { Elysia } from 'elysia';
import { logger } from '@bogeychan/elysia-logger';
import cors from '@elysiajs/cors';
import { inngestHandler } from '@/lib/inngest';
import { deploymentRoutes } from '@/services/deplyoment/deployment.service';
import { agentRoutes } from '@/services/agent/agent.service';

const port = 8000;

const app = new Elysia()
  .use(
    logger({
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
        },
      },
    })
  )
  .get('/', () => 'Hello World')
  .use(
    cors({
      origin: true, // Allow all origins in development
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'Origin',
      ],
      preflight: true,
    })
  )
  .get('/health', () => 'OK')
  .use(inngestHandler)
  .use(deploymentRoutes)
  .use(agentRoutes)
  .listen(port, ({ hostname, port }) => {
    console.log(`🦊 API is running at ${hostname}:${port}`);
  });
