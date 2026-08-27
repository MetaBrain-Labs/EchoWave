/**
 * 音频工作区共享契约测试。
 *
 * 验证统一处理状态和嵌套分析详情能够拒绝越界或时间顺序错误的数据。
 *
 * Responsibilities:
 * - 锁定移动端与 API 的新网络边界。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AudioAnalysisDetailSchema,
  AudioFileSummarySchema,
  AudioTranscriptionCapabilitiesResponseSchema,
  AudioTranscriptionStartRequestSchema,
  AUDIO_TRANSCRIPTION_MODELS,
  AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES,
  DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
  DataSourceAudioUploadResponseSchema,
  DataSourceCreateRequestSchema,
  DataSourceDetailSchema,
  DataSourceGroupLinkRequestSchema,
  DataSourceUpdateRequestSchema,
  GroupCreateRequestSchema,
} from '../../dist/index.js';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const thirdId = '33333333-3333-4333-8333-333333333333';

describe('workspace contracts', () => {
  it('trims valid group names and rejects empty or oversized names', () => {
    assert.deepEqual(GroupCreateRequestSchema.parse({ name: '  客户研究组  ' }), {
      name: '客户研究组',
    });
    assert.throws(() => GroupCreateRequestSchema.parse({ name: '   ' }));
    assert.throws(() => GroupCreateRequestSchema.parse({ name: '分'.repeat(121) }));
    assert.throws(() => GroupCreateRequestSchema.parse({ name: 42 }));
  });

  it('validates structured audio failure states and progress bounds', () => {
    const audio = AudioFileSummarySchema.parse({
      id: firstId,
      sourceId: null,
      title: '访谈',
      durationMs: 1_000,
      createdAt: '2026-08-21T10:00:00.000Z',
      sharedFrom: null,
      hasTranscript: false,
      status: {
        kind: 'failed',
        stage: 'transcription',
        code: 'UNSUPPORTED_CODEC',
        message: '编码不支持。',
        retryable: false,
        details: {
          category: 'semantic_validation',
          chunkIndex: 1,
          chunkCount: 2,
          structureAttempts: 2,
          issues: [
            {
              path: 'segments.0.endMs',
              code: 'timestamp_out_of_bounds',
              message: '片段时间戳超出当前分块。',
            },
          ],
          outputLength: 120,
          outputSha256: 'a'.repeat(64),
        },
      },
    });

    assert.equal(audio.status.kind, 'failed');
    assert.equal(audio.status.details.issues[0].code, 'timestamp_out_of_bounds');
    assert.throws(() =>
      AudioFileSummarySchema.parse({
        ...audio,
        status: {
          ...audio.status,
          details: { ...audio.status.details, outputSha256: 'unsafe' },
        },
      }),
    );
    assert.throws(() =>
      AudioFileSummarySchema.parse({
        ...audio,
        status: { kind: 'analyzing', progress: 101 },
      }),
    );

    const processing = AudioFileSummarySchema.parse({
      ...audio,
      status: {
        kind: 'transcribing',
        progress: 43,
        activity: {
          stage: 'correcting',
          chunkIndex: 2,
          chunkCount: 4,
          chunkStartMs: 238_000,
          chunkEndMs: 482_000,
          networkAttempt: 1,
          structureAttempt: 3,
          updatedAt: '2026-08-24T15:00:00.000Z',
        },
      },
    });
    assert.equal(processing.status.activity.stage, 'correcting');
    const splitting = AudioFileSummarySchema.parse({
      ...processing,
      status: {
        ...processing.status,
        activity: {
          ...processing.status.activity,
          stage: 'splitting',
          chunkCount: 8,
          chunkIndex: 3,
          networkAttempt: null,
          structureAttempt: null,
        },
      },
    });
    assert.equal(splitting.status.activity.stage, 'splitting');
    assert.throws(() =>
      AudioFileSummarySchema.parse({
        ...processing,
        status: {
          ...processing.status,
          activity: { ...processing.status.activity, networkAttempt: 4 },
        },
      }),
    );
    assert.throws(() =>
      AudioFileSummarySchema.parse({
        ...processing,
        status: {
          ...processing.status,
          activity: { ...processing.status.activity, chunkIndex: 5 },
        },
      }),
    );
  });

  it('validates transcription preprocessing requests and capability responses', () => {
    assert.deepEqual(AudioTranscriptionStartRequestSchema.parse({}), {
      preprocessing: 'whole_file',
      segmentationMode: 'speaker_turn',
    });
    assert.throws(() =>
      AudioTranscriptionStartRequestSchema.parse({
        model: 'unknown/model',
        preprocessing: 'whole_file',
      }),
    );
    assert.throws(() => AudioTranscriptionStartRequestSchema.parse({ preprocessing: 'direct' }));
    assert.deepEqual(
      AudioTranscriptionStartRequestSchema.parse({
        model: 'qwen-audio-3.0-asr-flash-filetrans',
        preprocessing: 'whole_file',
        segmentationMode: 'speaker_turn',
      }),
      {
        model: 'qwen-audio-3.0-asr-flash-filetrans',
        preprocessing: 'whole_file',
        segmentationMode: 'speaker_turn',
      },
    );
    assert.throws(() =>
      AudioTranscriptionStartRequestSchema.parse({
        model: 'unknown/model',
        preprocessing: 'whole_file',
        segmentationMode: 'speaker_turn',
      }),
    );
    assert.throws(() =>
      AudioTranscriptionStartRequestSchema.parse({
        model: 'qwen-audio-3.0-asr-flash-filetrans',
        preprocessing: 'whole_file',
        segmentationMode: 'readable',
      }),
    );
    const capabilities = AudioTranscriptionCapabilitiesResponseSchema.parse({
      defaultModel: DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
      models: AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES,
      ffmpeg: { configured: false, available: false },
      transcriptionConfigured: false,
    });
    assert.equal(capabilities.transcriptionConfigured, false);
    assert.equal(AUDIO_TRANSCRIPTION_MODELS.length, 1);
    assert.equal(DEFAULT_AUDIO_TRANSCRIPTION_MODEL, 'qwen-audio-3.0-asr-flash-filetrans');
    const qwenFileTrans = AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES[0];
    assert.equal(qwenFileTrans.provider, 'dashscope');
    assert.deepEqual(qwenFileTrans.supportedSegmentationModes, ['speaker_turn']);
    assert.deepEqual(qwenFileTrans.pricing, {
      asOf: '2026-08-26',
      input: { amount: 0.00022, currency: 'CNY', unit: 'second' },
      output: { amount: 0, currency: 'CNY', unit: 'included' },
    });
    assert.equal(qwenFileTrans.timestampGranularity, 'segment');
    const gptTranscribe = { description: 'Chunk 范围回退' };
    assert.match(gptTranscribe.description, /Chunk 范围回退/);
  });

  it('validates data-source settings without accepting credentials', () => {
    const source = DataSourceDetailSchema.parse({
      id: firstId,
      name: '团队录音空间',
      description: '',
      sourceType: 'manual_upload',
      location: 'local',
      connectionLabel: '手动上传',
      connectionStatus: 'connected',
      linkedGroupCount: 1,
      lastUploadedAt: null,
      metrics: { audioCount: 0, totalDurationMs: 0, transcribedCount: 0, pendingCount: 0 },
      settings: {
        transcriptionModel: 'qwen-audio-3.0-asr-flash-filetrans',
        autoTranscribe: true,
        emotionAnalysis: true,
        speakerDiarization: true,
        sceneSegmentation: true,
        skipInvalidAudio: true,
      },
      apiKey: 'must-be-stripped',
    });

    assert.equal('apiKey' in source, false);
  });

  it('validates data-source writes and trims user-editable fields', () => {
    assert.deepEqual(
      DataSourceCreateRequestSchema.parse({ name: '  客户访谈  ', description: '  一线反馈  ' }),
      { name: '客户访谈', description: '一线反馈' },
    );
    assert.deepEqual(DataSourceUpdateRequestSchema.parse({ description: '   ' }), {
      description: '',
    });
    assert.throws(() => DataSourceCreateRequestSchema.parse({ name: '   ' }));
    assert.throws(() => DataSourceCreateRequestSchema.parse({ name: '名'.repeat(121) }));
    assert.throws(() =>
      DataSourceCreateRequestSchema.parse({ name: '有效', description: '描'.repeat(1_001) }),
    );
    assert.throws(() => DataSourceUpdateRequestSchema.parse({}));
  });

  it('rejects duplicate group links and parses ordered audio upload responses', () => {
    assert.deepEqual(DataSourceGroupLinkRequestSchema.parse({ groupIds: [firstId, secondId] }), {
      groupIds: [firstId, secondId],
    });
    assert.throws(() => DataSourceGroupLinkRequestSchema.parse({ groupIds: [] }));
    assert.throws(() => DataSourceGroupLinkRequestSchema.parse({ groupIds: [firstId, firstId] }));
    assert.throws(() => DataSourceGroupLinkRequestSchema.parse({ groupIds: ['bad'] }));

    const response = DataSourceAudioUploadResponseSchema.parse({
      ingestionRunId: thirdId,
      items: [
        {
          id: firstId,
          sourceId: secondId,
          title: '客户访谈',
          durationMs: 1_000,
          createdAt: '2026-08-21T10:00:00.000Z',
          sharedFrom: null,
          hasTranscript: true,
          status: { kind: 'waiting' },
        },
      ],
    });
    assert.equal(response.items[0].status.kind, 'waiting');
  });

  it('rejects reversed transcript and invalid-segment time ranges', () => {
    const detail = {
      id: firstId,
      audioFileId: secondId,
      revision: 1,
      title: '产品访谈分析',
      durationMs: 10_000,
      generatedAt: '2026-08-21T10:00:00.000Z',
      transcription: {
        model: 'qwen-audio-3.0-asr-flash-filetrans',
        language: 'zh',
        diarizationStatus: 'not_returned',
        responseGranularity: 'chunk',
      },
      scenes: [
        {
          id: thirdId,
          index: 1,
          title: '开场',
          startMs: 0,
          segments: [
            {
              id: firstId,
              index: 1,
              speakerKey: 'host',
              speakerLabel: '主持人',
              businessRole: '主持人',
              emotion: '专注',
              startMs: 0,
              endMs: 1_000,
              text: '你好。',
              aiTag: null,
            },
          ],
        },
      ],
      invalidSegments: [],
      summarySections: [],
    };

    assert.equal(AudioAnalysisDetailSchema.parse(detail).scenes.length, 1);
    assert.deepEqual(AudioAnalysisDetailSchema.parse(detail).transcription, {
      ...detail.transcription,
      segmentationMode: 'readable',
      speakerIdentityScope: 'none',
    });
    assert.throws(() =>
      AudioAnalysisDetailSchema.parse({
        ...detail,
        scenes: [
          {
            ...detail.scenes[0],
            segments: [{ ...detail.scenes[0].segments[0], startMs: 1_000, endMs: 500 }],
          },
        ],
      }),
    );
  });
});
