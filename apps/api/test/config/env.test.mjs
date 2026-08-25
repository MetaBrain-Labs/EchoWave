import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readApiConfig } from '../../dist/config/env.js';

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
      AUDIO_STORAGE_DIR: '.data/audio',
      AUDIO_TRANSCRIPTION_MODEL: 'x-ai/grok-stt-1.0',
      AUDIO_TRANSCRIPTION_TEMP_DIR: '.tmp/audio-transcription',
      FFMPEG_PATH: 'C:\\ffmpeg\\ffmpeg.exe',
      AI_EXECUTION_REPORT_ENABLED: 'false',
      AI_EXECUTION_REPORT_OUTPUT_DIR: '.ai-execution-reports',
      AI_EXECUTION_REPORT_CONTEXT_ENABLED: 'false',
      AI_EXECUTION_REPORT_TOOL_CONTENT_ENABLED: 'false',
      AI_EXECUTION_REPORT_OUTPUT_ENABLED: 'false',
      AI_EXECUTION_REPORT_REASONING_ENABLED: 'false',
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
        audioStorageDir: '.data/audio',
        audioTranscriptionModel: 'x-ai/grok-stt-1.0',
        audioTranscriptionTempDir: '.tmp/audio-transcription',
        ffmpegPath: 'C:\\ffmpeg\\ffmpeg.exe',
      },
      aiExecutionReports: {
        enabled: false,
        outputDirectory: '.ai-execution-reports',
        includeContext: false,
        includeToolContent: false,
        includeOutput: false,
        includeReasoning: false,
      },
    });
  });

  it('rejects invalid boolean values instead of coercing them', () => {
    assert.throws(() => readApiConfig({ POSTGRES_SSL: 'yes' }));
    assert.throws(() => readApiConfig({ REDIS_TLS: '1' }));
    assert.throws(() => readApiConfig({ AI_EXECUTION_REPORT_ENABLED: '1' }));
  });

  it('requires all configuration to be present in the .env input', () => {
    assert.throws(() => readApiConfig({}));
  });

  it('allows FFmpeg to be omitted without weakening other required configuration', () => {
    const values = {
      PORT: '3101',
      CORS_ORIGINS: 'http://localhost:8081',
      POSTGRES_HOST: 'localhost',
      POSTGRES_PORT: '5432',
      POSTGRES_USER: 'echowave',
      POSTGRES_PASSWORD: '',
      POSTGRES_DB: 'echowave',
      POSTGRES_SCHEMA: 'echowave',
      POSTGRES_SSL: 'false',
      REDIS_HOST: 'localhost',
      REDIS_PORT: '6379',
      REDIS_PASSWORD: '',
      REDIS_USERNAME: '',
      REDIS_DB: '0',
      REDIS_TLS: 'false',
      DEV_TENANT_ID: '00000000-0000-4000-8000-000000000001',
      OPENROUTER_API_KEY: 'test',
      RAG_EMBEDDING_MODEL: 'qwen/qwen3-embedding-8b',
      RAG_EMBEDDING_DIMENSIONS: '1024',
      DEEPSEEK_API_KEY: 'test',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
      DEEPSEEK_CHAT_MODEL: 'deepseek-v4-flash',
      DEEPSEEK_ENABLE_THINKING: 'false',
      LANGGRAPH_SCHEMA: 'echowave_graph',
      UPLOAD_TEMP_DIR: '.tmp/uploads',
      AUDIO_STORAGE_DIR: '.data/audio',
      AUDIO_TRANSCRIPTION_MODEL: 'x-ai/grok-stt-1.0',
      AUDIO_TRANSCRIPTION_TEMP_DIR: '.tmp/audio-transcription',
      AI_EXECUTION_REPORT_ENABLED: 'false',
      AI_EXECUTION_REPORT_OUTPUT_DIR: '.ai-execution-reports',
      AI_EXECUTION_REPORT_CONTEXT_ENABLED: 'false',
      AI_EXECUTION_REPORT_TOOL_CONTENT_ENABLED: 'false',
      AI_EXECUTION_REPORT_OUTPUT_ENABLED: 'false',
      AI_EXECUTION_REPORT_REASONING_ENABLED: 'false',
    };

    assert.equal(readApiConfig(values).rag.ffmpegPath, undefined);
    assert.equal(readApiConfig({ ...values, FFMPEG_PATH: '' }).rag.ffmpegPath, undefined);
    for (const model of [
      'x-ai/grok-stt-1.0',
      'qwen/qwen3-asr-1.7b',
      'openai/whisper-large-v3',
      'openai/gpt-transcribe',
      'mistralai/voxtral-mini-transcribe',
    ]) {
      assert.equal(
        readApiConfig({ ...values, AUDIO_TRANSCRIPTION_MODEL: model }).rag.audioTranscriptionModel,
        model,
      );
    }
    assert.throws(() =>
      readApiConfig({ ...values, AUDIO_TRANSCRIPTION_MODEL: 'google/gemini-2.5-flash-lite' }),
    );
  });
});
