import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HelloResponseSchema } from '@echowave/contracts';

import { createApp } from '../dist/app.js';
import { readApiConfig } from '../dist/env.js';
import { formatServerStartError } from '../dist/serverError.js';

const app = createApp({ corsOrigins: ['http://localhost:8081'] });

describe('EchoWave API', () => {
  it('returns the shared HelloWorld contract', async () => {
    const response = await app.request('/api/hello');
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(HelloResponseSchema.parse(body), {
      ok: true,
      service: 'echowave-api',
      message: 'HelloWorld',
    });
  });

  it('returns a compact structured 404 response', async () => {
    const response = await app.request('/missing');

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found.',
        retryable: false,
      },
    });
  });
});

describe('API environment', () => {
  it('normalizes PostgreSQL and Redis environment variables', () => {
    const config = readApiConfig({
      PORT: '3101',
      CORS_ORIGINS: 'http://localhost:8081, http://localhost:19006',
      POSTGRES_HOST: 'db.internal',
      POSTGRES_PORT: '5433',
      POSTGRES_USER: 'echowave',
      POSTGRES_PASSWORD: 'secret',
      POSTGRES_DB: 'meta-pm-agent',
      POSTGRES_SCHEMA: 'private',
      POSTGRES_SSL: 'true',
      REDIS_HOST: 'redis.internal',
      REDIS_PORT: '6380',
      REDIS_PASSWORD: 'secret',
      REDIS_USERNAME: 'echowave',
      REDIS_DB: '2',
      REDIS_TLS: 'true',
      DEV_TENANT_ID: '00000000-0000-4000-8000-000000000001',
      OPENROUTER_API_KEY: 'openrouter-test-key',
      RAG_EMBEDDING_MODEL: 'qwen/qwen3-embedding-8b',
      RAG_EMBEDDING_DIMENSIONS: '1024',
      DEEPSEEK_API_KEY: 'deepseek-test-key',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com/',
      DEEPSEEK_CHAT_MODEL: 'deepseek-v4-flash',
      DEEPSEEK_ENABLE_THINKING: 'false',
      LANGGRAPH_SCHEMA: 'echowave_graph',
      UPLOAD_TEMP_DIR: '.tmp/uploads',
    });

    assert.deepEqual(config, {
      port: 3101,
      corsOrigins: ['http://localhost:8081', 'http://localhost:19006'],
      database: {
        host: 'db.internal',
        port: 5433,
        user: 'echowave',
        password: 'secret',
        database: 'meta-pm-agent',
        schema: 'private',
        ssl: true,
      },
      redis: {
        host: 'redis.internal',
        port: 6380,
        password: 'secret',
        username: 'echowave',
        database: 2,
        tls: true,
      },
      rag: {
        tenantId: '00000000-0000-4000-8000-000000000001',
        openRouterApiKey: 'openrouter-test-key',
        embeddingModel: 'qwen/qwen3-embedding-8b',
        embeddingDimensions: 1024,
        deepSeekApiKey: 'deepseek-test-key',
        deepSeekBaseUrl: 'https://api.deepseek.com',
        deepSeekChatModel: 'deepseek-v4-flash',
        enableThinking: false,
        langGraphSchema: 'echowave_graph',
        uploadTempDir: '.tmp/uploads',
      },
    });
  });

  it('rejects invalid boolean values instead of coercing them', () => {
    assert.throws(() => readApiConfig({ POSTGRES_SSL: 'yes' }));
    assert.throws(() => readApiConfig({ REDIS_TLS: '1' }));
  });

  it('requires all configuration to be present in the .env input', () => {
    assert.throws(() => readApiConfig({}));
  });
});

describe('API listener errors', () => {
  it('explains how to resolve an occupied port', () => {
    const error = Object.assign(new Error('listen failed'), {
      code: 'EADDRINUSE',
    });

    assert.equal(
      formatServerStartError(error, 3101),
      'EchoWave API could not start: port 3101 is already in use. Stop the existing process or change PORT in apps/api/.env.',
    );
  });
});
