/** Defines the HTTP transport boundary without starting a network listener. */
import { HelloResponseSchema } from '@echowave/contracts';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import type { ApiConfig } from './env.ts';

export type ErrorResponse = {
  ok: false;
  error: {
    code: 'INTERNAL_ERROR' | 'NOT_FOUND';
    message: string;
  };
};

export function createApp(config: Pick<ApiConfig, 'corsOrigins'>) {
  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: config.corsOrigins,
      allowMethods: ['GET', 'OPTIONS'],
    }),
  );

  app.get('/api/hello', (context) => {
    const response = HelloResponseSchema.parse({
      ok: true,
      service: 'echowave-api',
      message: 'HelloWorld',
    });

    return context.json(response);
  });

  app.notFound((context) =>
    context.json<ErrorResponse>(
      {
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Route not found.',
        },
      },
      404,
    ),
  );

  app.onError((error, context) => {
    console.error('Unhandled API error', error);
    return context.json<ErrorResponse>(
      {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'The service could not complete the request.',
        },
      },
      500,
    );
  });

  return app;
}

export type EchoWaveApp = ReturnType<typeof createApp>;
