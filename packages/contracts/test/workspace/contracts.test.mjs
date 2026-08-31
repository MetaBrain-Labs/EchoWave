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
  AudioBusinessAnalysisStartRequestSchema,
  AudioBusinessAnalysisStateSchema,
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
  GroupResourceLinksUpdateRequestSchema,
  GroupSettingsUpdateRequestSchema,
  AudioPostAnalysisStartResponseSchema,
  AudioAnalysisStatusStreamEventSchema,
  BusinessAnalysisCitationSchema,
  DataSourceAudioStreamEventSchema,
  KnowledgeDocumentStreamEventSchema,
  AudioTranscriptConfirmationRequestSchema,
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

  it('validates analysis settings and atomic resource-link replacements', () => {
    const settings = GroupSettingsUpdateRequestSchema.parse({
      name: '  销售复盘组  ',
      analysis: {
        timing: 'automatic',
        contentFocus: '  关注异议处理  ',
        tone: '  正式、专业  ',
        customTags: ['需求探索', '促成动作'],
      },
    });
    assert.equal(settings.name, '销售复盘组');
    assert.equal(settings.analysis.contentFocus, '关注异议处理');
    assert.throws(() =>
      GroupSettingsUpdateRequestSchema.parse({
        ...settings,
        analysis: { ...settings.analysis, customTags: ['风险', '风险'] },
      }),
    );
    assert.deepEqual(GroupResourceLinksUpdateRequestSchema.parse({ ids: [] }), { ids: [] });
    assert.throws(() => GroupResourceLinksUpdateRequestSchema.parse({ ids: [firstId, firstId] }));
  });

  it('validates versioned business analyses with multi-segment evidence', () => {
    const result = {
      jobId: firstId,
      groupId: secondId,
      confirmationVersion: 2,
      model: 'deepseek-v4-flash',
      generatedAt: '2026-08-28T08:00:00.000Z',
      knowledgeBaseIds: [thirdId],
      knowledgeStatus: 'used',
      limitations: [],
      summarySections: [
        { id: thirdId, index: 1, title: '总体总结', body: '销售能够回应核心异议。' },
      ],
      tags: [
        {
          id: thirdId,
          category: 'strength',
          customLabel: null,
          title: '异议回应清晰',
          summary: '用实际结果回应了客户顾虑。',
          details: ['先确认顾虑，再给出证据。'],
          confidence: 88,
          evidenceSegmentIds: [firstId, secondId],
          citations: [],
        },
      ],
    };
    const state = AudioBusinessAnalysisStateSchema.parse({
      state: 'ready',
      groupId: secondId,
      jobId: firstId,
      model: 'deepseek-v4-flash',
      progress: 100,
      confirmationVersion: 2,
      settingsCurrent: true,
      knowledgeCurrent: true,
      error: null,
      result,
    });
    assert.deepEqual(state.result.tags[0].evidenceSegmentIds, [firstId, secondId]);
    assert.deepEqual(AudioBusinessAnalysisStartRequestSchema.parse({ groupId: secondId }), {
      groupId: secondId,
      force: false,
    });
    assert.throws(() =>
      AudioBusinessAnalysisStateSchema.parse({
        ...state,
        result: {
          ...result,
          tags: [{ ...result.tags[0], category: 'unknown' }],
        },
      }),
    );
    assert.throws(() =>
      AudioBusinessAnalysisStateSchema.parse({
        ...state,
        result: {
          ...result,
          tags: [{ ...result.tags[0], evidenceSegmentIds: [firstId, firstId] }],
        },
      }),
    );
  });

  it('requires a bounded knowledge excerpt on every business-analysis citation', () => {
    const citation = {
      chunkId: firstId,
      knowledgeBaseId: secondId,
      documentId: thirdId,
      documentTitle: '销售异议处理手册',
      excerpt: '先确认客户顾虑，再使用可核实的案例说明方案价值。',
      locator: { kind: 'markdown', headingPath: ['异议处理'], lineStart: 12, lineEnd: 18 },
    };

    assert.equal(BusinessAnalysisCitationSchema.parse(citation).excerpt, citation.excerpt);
    assert.throws(() => BusinessAnalysisCitationSchema.parse({ ...citation, excerpt: '' }));
    assert.throws(() =>
      BusinessAnalysisCitationSchema.parse({ ...citation, excerpt: '知'.repeat(241) }),
    );
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
    const awaitingCallback = AudioFileSummarySchema.parse({
      ...processing,
      status: {
        ...processing.status,
        activity: {
          ...processing.status.activity,
          stage: 'awaiting_result',
          chunkIndex: null,
          chunkCount: null,
          chunkStartMs: null,
          chunkEndMs: null,
          networkAttempt: null,
          structureAttempt: null,
        },
      },
    });
    assert.equal(awaitingCallback.status.activity.stage, 'awaiting_result');
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
    assert.equal(
      AudioTranscriptionStartRequestSchema.parse({ preprocessing: 'silero_vad' }).preprocessing,
      'silero_vad',
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
      sileroVad: {
        model: 'silero-vad-v6.2.1',
        available: false,
        unavailableReason: 'Silero VAD unavailable.',
      },
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
    assert.deepEqual(
      DataSourceUpdateRequestSchema.parse({ customBusinessRoles: [' 售后 ', '技术顾问'] }),
      { customBusinessRoles: ['售后', '技术顾问'] },
    );
    assert.throws(() => DataSourceUpdateRequestSchema.parse({ customBusinessRoles: ['销售'] }));
    assert.throws(() =>
      DataSourceUpdateRequestSchema.parse({ customBusinessRoles: ['售后', '售后'] }),
    );
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
      transcriptConfirmation: { status: 'pending', currentVersion: 0, confirmedAt: null },
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
              rawText: '你好。',
              confirmedText: null,
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
      preprocessingMode: 'whole_file',
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

  it('validates post-analysis task and rich segment results', () => {
    const response = AudioPostAnalysisStartResponseSchema.parse({
      audioFileId: firstId,
      revisionId: secondId,
      jobId: thirdId,
      type: 'emotion',
      status: 'queued',
    });
    assert.equal(response.type, 'emotion');

    const detail = AudioAnalysisDetailSchema.parse({
      id: firstId,
      audioFileId: secondId,
      revision: 1,
      title: '客户通话',
      durationMs: 2_000,
      generatedAt: '2026-08-27T10:00:00.000Z',
      transcription: {
        model: 'qwen-audio-3.0-asr-flash-filetrans',
        language: 'zh',
        diarizationStatus: 'observed',
        responseGranularity: 'segment',
        segmentationMode: 'speaker_turn',
        speakerIdentityScope: 'recording',
      },
      transcriptConfirmation: {
        status: 'confirmed',
        currentVersion: 2,
        confirmedAt: '2026-08-27T10:00:30.000Z',
      },
      postAnalysis: {
        emotion: {
          state: 'ready',
          jobId: thirdId,
          model: 'qwen3.5-omni-flash',
          completedAt: '2026-08-27T10:01:00.000Z',
          confirmationVersion: 1,
        },
        role: { state: 'idle' },
      },
      scenes: [
        {
          id: thirdId,
          index: 1,
          title: '完整录音',
          startMs: 0,
          segments: [
            {
              id: firstId,
              index: 1,
              speakerKey: 'Speaker 0',
              speakerLabel: 'Speaker 0',
              businessRole: '客户',
              emotion: 'impatient',
              startMs: 0,
              endMs: 1_000,
              rawText: '行，我晓得了。',
              confirmedText: '行，我知道了。',
              aiTag: null,
              roleAnalysis: null,
              emotionAnalysis: {
                label: 'impatient',
                confidence: 0.88,
                attitude: 'dismissive',
                arousal: 'high',
                pace: 'fast',
                volumeTrend: 'elevated',
                pitchVariation: 'medium',
                pausePattern: 'few',
                vocalCues: ['语速明显加快'],
                model: 'qwen3.5-omni-flash',
              },
            },
          ],
        },
      ],
      invalidSegments: [],
      summarySections: [],
    });
    assert.equal(detail.scenes[0].segments[0].emotionAnalysis.confidence, 0.88);
    assert.throws(() =>
      AudioAnalysisDetailSchema.parse({
        ...detail,
        scenes: [
          {
            ...detail.scenes[0],
            segments: [
              {
                ...detail.scenes[0].segments[0],
                emotionAnalysis: {
                  ...detail.scenes[0].segments[0].emotionAnalysis,
                  confidence: 1.1,
                },
              },
            ],
          },
        ],
      }),
    );
  });

  it('validates complete transcript confirmation request syntax and rejects duplicate segments', () => {
    const request = AudioTranscriptConfirmationRequestSchema.parse({
      analysisRevisionId: firstId,
      baseVersion: 0,
      segments: [{ segmentId: secondId, text: '  修正后的正文  ' }],
    });
    assert.equal(request.segments[0].text, '修正后的正文');
    assert.throws(() =>
      AudioTranscriptConfirmationRequestSchema.parse({
        analysisRevisionId: firstId,
        baseVersion: 1,
        segments: [
          { segmentId: secondId, text: '甲' },
          { segmentId: secondId, text: '乙' },
        ],
      }),
    );
    assert.throws(() =>
      AudioTranscriptConfirmationRequestSchema.parse({
        analysisRevisionId: firstId,
        baseVersion: -1,
        segments: [{ segmentId: secondId, text: '   ' }],
      }),
    );
  });

  it('validates realtime snapshots and rejects unsafe event shapes', () => {
    const common = { cursor: '1', occurredAt: '2026-08-30T01:00:00.000Z' };
    const audioSnapshot = DataSourceAudioStreamEventSchema.parse({
      ...common,
      type: 'snapshot',
      dataSourceId: firstId,
      items: [
        {
          id: secondId,
          sourceId: firstId,
          title: '访谈录音',
          durationMs: 1_000,
          createdAt: common.occurredAt,
          sharedFrom: null,
          hasTranscript: false,
          status: { kind: 'waiting' },
        },
      ],
    });
    assert.equal(audioSnapshot.items.length, 1);

    const analysisSnapshot = AudioAnalysisStatusStreamEventSchema.parse({
      ...common,
      type: 'snapshot',
      audioFileId: firstId,
      analysisRevisionId: secondId,
      state: {
        emotion: { state: 'idle' },
        role: { state: 'idle' },
        business: {
          state: 'idle',
          groupId: null,
          jobId: null,
          model: null,
          progress: 0,
          confirmationVersion: null,
          settingsCurrent: true,
          knowledgeCurrent: true,
          error: null,
        },
      },
    });
    assert.equal(analysisSnapshot.state.business.state, 'idle');

    assert.throws(() =>
      KnowledgeDocumentStreamEventSchema.parse({
        ...common,
        type: 'document',
        knowledgeBaseId: firstId,
        item: { prompt: 'must not be accepted' },
        terminal: false,
      }),
    );
  });
});
