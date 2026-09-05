import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';

import { readApiConfig, readApiConfigFile } from '../../dist/config/env.js';
import { createDatabaseConfig, DatabaseEnvironmentSchema } from '../../dist/config/database.js';
import { createHttpConfig, HttpEnvironmentSchema } from '../../dist/config/http.js';

const completeValues = {
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
  CREDENTIAL_MASTER_KEY: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=',
  CONFIGURATION_ADMIN_TOKEN: 'configuration-admin-token-for-tests',
  LOCAL_CREDENTIALS_FILE: '.data/secrets/credentials.yaml',
  TRUSTED_PROXY_CIDRS: '127.0.0.1/32, ::1/128',
  DEV_TENANT_ID: '00000000-0000-4000-8000-000000000001',
  DASHSCOPE_API_KEY: 'dashscope-test-key',
  DASHSCOPE_BASE_URL: 'https://workspace.example.com/api/v1/',
  DASHSCOPE_COMPATIBLE_BASE_URL: 'https://workspace.example.com/compatible-mode/v1/',
  DASHSCOPE_ASYNC_NOTIFY_MODE: 'eventbridge',
  DASHSCOPE_EVENTBRIDGE_CALLBACK_URL:
    'https://api.example.com/api/webhooks/dashscope/async-task-finished',
  DASHSCOPE_EVENTBRIDGE_CALLBACK_TOKEN: 'eventbridge-secret',
  RAG_EMBEDDING_MODEL: 'qwen3.7-text-embedding',
  RAG_EMBEDDING_DIMENSIONS: '1024',
  DEEPSEEK_API_KEY: 'deepseek-test-key',
  DEEPSEEK_BASE_URL: 'https://api.deepseek.com/',
  DEEPSEEK_CHAT_MODEL: 'deepseek-v4-flash',
  DEEPSEEK_ENABLE_THINKING: 'false',
  LANGGRAPH_SCHEMA: 'echowave_graph',
  UPLOAD_TEMP_DIR: '.tmp/uploads',
  AUDIO_STORAGE_DIR: '.data/audio',
  AUDIO_TRANSCRIPTION_MODEL: 'qwen-audio-3.0-asr-flash-filetrans',
  AUDIO_EMOTION_MODEL: 'qwen3.5-omni-flash',
  AUDIO_TRANSCRIPTION_TEMP_DIR: '.tmp/audio-transcription',
  AUDIO_TRANSCRIPTION_MAX_IN_FLIGHT: '1',
  FFMPEG_PATH: 'C:\\ffmpeg\\ffmpeg.exe',
  AI_EXECUTION_REPORT_ENABLED: 'false',
  AI_EXECUTION_REPORT_OUTPUT_DIR: '.ai-execution-reports',
  AI_EXECUTION_REPORT_CONTEXT_ENABLED: 'false',
  AI_EXECUTION_REPORT_TOOL_CONTENT_ENABLED: 'false',
  AI_EXECUTION_REPORT_OUTPUT_ENABLED: 'false',
  AI_EXECUTION_REPORT_REASONING_ENABLED: 'false',
  AI_EXECUTION_REPORT_STT_RAW_RESPONSE_ENABLED: 'true',
  PUSH_NOTIFICATIONS_ENABLED: 'true',
};

describe('API environment', () => {
  it('parses HTTP and PostgreSQL modules independently before composition', () => {
    assert.deepEqual(createHttpConfig(HttpEnvironmentSchema.parse(completeValues)), {
      port: 3101,
      corsOrigins: ['http://localhost:8081', 'http://localhost:19006'],
    });
    assert.deepEqual(createDatabaseConfig(DatabaseEnvironmentSchema.parse(completeValues)), {
      host: 'db.internal',
      port: 5433,
      user: 'echowave',
      password: 'secret',
      database: 'meta-pm-agent',
      schema: 'private',
      ssl: true,
    });
  });

  it('reports the exact missing .env file without reading process.env', () => {
    const missing = pathToFileURL('Z:/definitely-missing/echowave-api.env');
    assert.throws(
      () => readApiConfigFile(missing),
      /Required API configuration file was not found/,
    );
  });

  it('normalizes the shared DashScope configuration', () => {
    const config = readApiConfig(completeValues);
    assert.deepEqual(config.rag.dashScope, {
      apiKey: 'dashscope-test-key',
      baseUrl: 'https://workspace.example.com/api/v1',
      compatibleBaseUrl: 'https://workspace.example.com/compatible-mode/v1',
      asyncNotifyMode: 'eventbridge',
      eventBridgeCallback: {
        url: 'https://api.example.com/api/webhooks/dashscope/async-task-finished',
        token: 'eventbridge-secret',
      },
    });
    assert.equal(config.rag.embeddingModel, 'qwen3.7-text-embedding');
    assert.equal(config.rag.embeddingDimensions, 1024);
    assert.equal(config.rag.audioTranscriptionModel, 'qwen-audio-3.0-asr-flash-filetrans');
    assert.equal(config.rag.audioEmotionModel, 'qwen3.5-omni-flash');
    assert.equal(config.rag.audioTranscriptionMaxInFlight, 1);
    assert.equal(config.rag.ffmpegPath, 'C:\\ffmpeg\\ffmpeg.exe');
    assert.deepEqual(config.corsOrigins, ['http://localhost:8081', 'http://localhost:19006']);
    assert.deepEqual(config.settingsSecurity.trustedProxyCidrs, ['127.0.0.1/32', '::1/128']);
    assert.equal(config.settingsSecurity.credentialMasterKey.byteLength, 32);
    assert.equal(config.notifications.enabled, true);
  });

  it('resolves file paths relative to the API environment directory when loading a file', () => {
    const config = readApiConfig(completeValues, path.resolve('apps/api'));
    assert.equal(config.rag.audioStorageDir, path.resolve('apps/api/.data/audio'));
    assert.equal(
      config.rag.audioTranscriptionTempDir,
      path.resolve('apps/api/.tmp/audio-transcription'),
    );
    assert.equal(config.rag.uploadTempDir, path.resolve('apps/api/.tmp/uploads'));
    assert.equal(
      config.settingsSecurity.localCredentialsFile,
      path.resolve('apps/api/.data/secrets/credentials.yaml'),
    );
  });

  it('allows OSS and FFmpeg to be omitted while embeddings remain configured', () => {
    const { FFMPEG_PATH: _ffmpegPath, ...values } = completeValues;
    const config = readApiConfig(values);
    assert.equal(config.rag.ffmpegPath, undefined);
    assert.equal(config.rag.dashScope.oss, undefined);
  });

  it('marks partial legacy OSS as incomplete without blocking API startup', () => {
    const partial = readApiConfig({ ...completeValues, ALIYUN_OSS_REGION: 'oss-cn-beijing' });
    assert.equal(partial.rag.dashScope.oss, undefined);
    assert.ok(partial.legacyProviders.missingVariables.includes('ALIYUN_OSS_BUCKET'));
    const config = readApiConfig({
      ...completeValues,
      ALIYUN_OSS_REGION: 'oss-cn-beijing',
      ALIYUN_OSS_BUCKET: 'echowave-staging',
      ALIYUN_OSS_ACCESS_KEY_ID: 'oss-id',
      ALIYUN_OSS_ACCESS_KEY_SECRET: 'oss-secret',
    });
    assert.deepEqual(config.rag.dashScope.oss, {
      region: 'oss-cn-beijing',
      bucket: 'echowave-staging',
      accessKeyId: 'oss-id',
      accessKeySecret: 'oss-secret',
    });
  });

  it('reports incomplete EventBridge legacy configuration without importing it', () => {
    const { DASHSCOPE_EVENTBRIDGE_CALLBACK_TOKEN: _token, ...withoutToken } = completeValues;
    const incomplete = readApiConfig(withoutToken);
    assert.ok(
      incomplete.legacyProviders.missingVariables.includes('DASHSCOPE_EVENTBRIDGE_CALLBACK_TOKEN'),
    );
    const {
      DASHSCOPE_EVENTBRIDGE_CALLBACK_URL: _url,
      DASHSCOPE_EVENTBRIDGE_CALLBACK_TOKEN: _callbackToken,
      ...withoutCallback
    } = completeValues;
    const polling = readApiConfig({
      ...withoutCallback,
      DASHSCOPE_ASYNC_NOTIFY_MODE: 'polling',
    });
    assert.equal(polling.rag.dashScope.asyncNotifyMode, 'polling');
    assert.equal(polling.rag.dashScope.eventBridgeCallback, undefined);
    assert.throws(() =>
      readApiConfig({ ...completeValues, DASHSCOPE_ASYNC_NOTIFY_MODE: 'polling' }),
    );
    assert.throws(() =>
      readApiConfig({ ...withoutCallback, DASHSCOPE_ASYNC_NOTIFY_MODE: 'local' }),
    );
    assert.throws(() =>
      readApiConfig({
        ...completeValues,
        DASHSCOPE_EVENTBRIDGE_CALLBACK_URL: 'https://api.example.com/api/webhooks/dashscope',
      }),
    );
  });

  it('rejects removed providers, models, and invalid booleans', () => {
    assert.throws(() => readApiConfig({ ...completeValues, POSTGRES_SSL: 'yes' }));
    assert.throws(() =>
      readApiConfig({ ...completeValues, RAG_EMBEDDING_MODEL: 'unknown-embedding-model' }),
    );
    assert.throws(() =>
      readApiConfig({ ...completeValues, AUDIO_TRANSCRIPTION_MODEL: 'openai/gpt-4o-transcribe' }),
    );
    assert.throws(() => readApiConfig({ ...completeValues, TRUSTED_PROXY_CIDRS: '10.0.0.0/33' }));
    assert.throws(() =>
      readApiConfig({ ...completeValues, PUSH_NOTIFICATIONS_ENABLED: 'sometimes' }),
    );
  });

  it('starts without legacy provider variables and exposes their import completeness', () => {
    const { DASHSCOPE_API_KEY: _apiKey, ...withoutKey } = completeValues;
    const { DASHSCOPE_BASE_URL: _baseUrl, ...withoutBaseUrl } = completeValues;
    const { DASHSCOPE_COMPATIBLE_BASE_URL: _compatibleBaseUrl, ...withoutCompatibleBaseUrl } =
      completeValues;
    assert.ok(
      readApiConfig(withoutKey).legacyProviders.missingVariables.includes('DASHSCOPE_API_KEY'),
    );
    assert.ok(
      readApiConfig(withoutBaseUrl).legacyProviders.missingVariables.includes('DASHSCOPE_BASE_URL'),
    );
    assert.ok(
      readApiConfig(withoutCompatibleBaseUrl).legacyProviders.missingVariables.includes(
        'DASHSCOPE_COMPATIBLE_BASE_URL',
      ),
    );
    const bootstrapOnly = { ...completeValues };
    for (const key of Object.keys(bootstrapOnly)) {
      if (
        key.startsWith('DASHSCOPE_') ||
        key.startsWith('DEEPSEEK_') ||
        key.startsWith('ALIYUN_OSS_') ||
        key === 'RAG_EMBEDDING_MODEL' ||
        key === 'RAG_EMBEDDING_DIMENSIONS' ||
        key === 'AUDIO_TRANSCRIPTION_MODEL' ||
        key === 'AUDIO_EMOTION_MODEL'
      ) {
        delete bootstrapOnly[key];
      }
    }
    const config = readApiConfig(bootstrapOnly);
    assert.equal(config.legacyProviders.detectedVariables.length, 0);
    assert.equal(config.rag.embeddingModel, 'qwen3.7-text-embedding');
  });
});
