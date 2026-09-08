import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

export const SHOWCASE_DURATION_SECONDS = 150;

export const SHOWCASE_SCRIPT = [
  {
    start: 0,
    end: 7,
    titleZh: 'EchoWave',
    titleEn: 'From Voice to Insight',
    narrationZh: 'EchoWave，让每一段声音，都变成可检索、可分析、可行动的洞察。',
    subtitleEn: 'Turn every conversation into searchable, actionable insight.',
    visuals: [],
  },
  {
    start: 7,
    end: 20,
    titleZh: '从声音到洞察',
    titleEn: 'FROM VOICE TO INSIGHT',
    narrationZh:
      '访谈、会议和客户沟通常常散落在不同文件里。EchoWave 将采集、整理、转写、分析和知识检索放进同一条工作流。',
    subtitleEn: 'Capture, organize, transcribe, analyze and retrieve knowledge in one workflow.',
    visuals: [
      ['showcase/01-groups.png', 'stable/01-groups.png'],
      ['showcase/01-knowledge.png', 'stable/01-knowledge.png'],
      ['showcase/01-more.png', 'stable/01-more.png'],
    ],
  },
  {
    start: 20,
    end: 38,
    titleZh: '统一组织内容',
    titleEn: 'ORGANIZE WITH CONTEXT',
    narrationZh:
      '音频可以按团队和项目建立分组，通过数据源统一管理，再与知识库关联，让每一份信息都有清晰的上下文。',
    subtitleEn: 'Organize audio by team, project and connected knowledge.',
    visuals: [
      ['showcase/02-group-created.png', 'stable/02-group-created.png'],
      ['showcase/02-source-created.png', 'stable/01-data-sources.png'],
      ['showcase/03-document-ready.png', 'stable/02-knowledge-created.png'],
    ],
  },
  {
    start: 38,
    end: 54,
    titleZh: '一键启动完整流程',
    titleEn: 'ONE WORKFLOW',
    narrationZh: '选择音频后，一次操作即可启动完整分析。批次状态持续可见，失败与重试也有明确反馈。',
    subtitleEn: 'Start the complete analysis pipeline with one action.',
    visuals: [
      ['showcase/02-analysis-ready.png', 'stable/05-batch-validation.png'],
      ['showcase/02-analysis-processing.png', 'stable/02-audio-uploaded.png'],
    ],
  },
  {
    start: 54,
    end: 77,
    titleZh: '结构化转写',
    titleEn: 'STRUCTURED TRANSCRIPTION',
    narrationZh:
      '后端工作流会完成音频处理、说话人分离和带时间戳的转写，并继续识别业务角色与情绪，让原始录音成为结构化数据。',
    subtitleEn: 'Diarization, timestamps, roles and emotion turn audio into structured data.',
    visuals: [
      ['showcase/02-analysis-completed.png', 'stable/02-audio-uploaded.png'],
      ['showcase/02-report-transcript.png', 'stable/03-transcript.png'],
    ],
  },
  {
    start: 77,
    end: 97,
    titleZh: '不止于文字',
    titleEn: 'BEYOND THE TRANSCRIPT',
    narrationZh:
      'EchoWave 不只生成文字稿。它会整理访谈背景、核心痛点、产品期待和机会判断，同时保留版本与模型执行信息，方便复核。',
    subtitleEn: 'Go beyond transcripts with reviewable summaries and execution details.',
    visuals: [
      ['showcase/02-report-tasks.png', 'stable/03-tasks.png'],
      ['showcase/02-report-summary.png', 'stable/03-summary.png'],
      ['showcase/02-report-models.png', 'stable/03-model.png'],
    ],
  },
  {
    start: 97,
    end: 115,
    titleZh: '可追溯的知识问答',
    titleEn: 'TRACEABLE KNOWLEDGE',
    narrationZh:
      '文档解析完成后，可以直接向知识库提问。回答会附带引用来源，并能够回到原文核对，而不是只给出一个不可验证的结论。',
    subtitleEn: 'Ask questions with citations that link back to the source.',
    visuals: [
      ['showcase/03-answer-with-citation.png', 'stable/01-knowledge.png'],
      ['showcase/03-citation-open.png', 'stable/02-knowledge-created.png'],
    ],
  },
  {
    start: 115,
    end: 127,
    titleZh: '可控且可靠',
    titleEn: 'CONTROLLED & RELIABLE',
    narrationZh:
      '运行模式、服务状态和资源关联都可以显式管理。连接失败时，应用给出清晰反馈，并保留安全的取消路径。',
    subtitleEn: 'Explicit configuration and graceful failure handling.',
    visuals: [
      ['showcase/04-resource-associations.png', 'stable/06-group-settings.png'],
      ['showcase/04-invalid-server.png', 'stable/04-invalid-server.png'],
    ],
  },
  {
    start: 127,
    end: 142,
    titleZh: '为真实产品构建',
    titleEn: 'BUILT FOR A REAL PRODUCT',
    narrationZh:
      '移动端基于 Expo 和 React Native，服务端使用 TypeScript、Hono 与 Zod，结合 LangGraph、DeepAgents、PostgreSQL 和 pgvector，并由 Maestro 完成真实设备回归。',
    subtitleEn: 'Built with Expo, React Native, Hono, Zod, LangGraph, PostgreSQL and Maestro.',
    visuals: [],
    overlay:
      'Expo / React Native\\NTypeScript / Hono / Zod\\NLangGraph / DeepAgents\\NPostgreSQL / pgvector\\NMaestro / pnpm / Turborepo',
  },
  {
    start: 142,
    end: 150,
    titleZh: 'Explore EchoWave on GitHub',
    titleEn: 'github.com/MetaBrain-Labs/EchoWave',
    narrationZh:
      '这就是 EchoWave：从声音出发，把对话转化为可以持续使用的知识与洞察。欢迎在 GitHub 查看完整项目。',
    subtitleEn: 'Explore the complete EchoWave project on GitHub.',
    visuals: [],
    overlay: 'github.com/MetaBrain-Labs/EchoWave',
  },
];

/**
 * 校验脚本必须从零开始、连续覆盖并精确结束于 150 秒。
 */
export function validateShowcaseScript(sections = SHOWCASE_SCRIPT) {
  let cursor = 0;
  for (const section of sections) {
    if (section.start !== cursor || section.end <= section.start) {
      throw new Error(
        `视频脚本时间轴不连续：${section.start}-${section.end}，期望从 ${cursor} 开始。`,
      );
    }
    cursor = section.end;
  }
  if (cursor !== SHOWCASE_DURATION_SECONDS) {
    throw new Error(`视频脚本必须精确覆盖 ${SHOWCASE_DURATION_SECONDS} 秒，当前为 ${cursor} 秒。`);
  }
  return true;
}

/**
 * 校验成片探测结果，阻止缺音轨、错误时长或非目标编码的文件进入交付清单。
 */
export function validateShowcaseMediaProbe(probe, expectedDuration = SHOWCASE_DURATION_SECONDS) {
  const duration = Number(probe?.format?.duration);
  const video = probe?.streams?.find((stream) => stream.codec_type === 'video');
  const audio = probe?.streams?.find((stream) => stream.codec_type === 'audio');
  if (!Number.isFinite(duration) || Math.abs(duration - expectedDuration) > 0.25) {
    throw new Error(`成片时长不符合要求：${duration || 'unknown'} 秒。`);
  }
  if (!video || video.width !== 1920 || video.height !== 1080 || video.codec_name !== 'h264') {
    throw new Error('成片视频必须是 1920×1080 H.264。');
  }
  if (!audio) throw new Error('成片缺少音轨。');
  return { duration, video, audio };
}

function filesBelow(directory, predicate) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path, predicate) : predicate(path) ? [path] : [];
  });
}

/**
 * 按 takeScreenshot 后的相对路径解析每个章节素材，并记录降级到 stable 截图的情况。
 */
export function resolveSectionVisuals(runDirectory, sections = SHOWCASE_SCRIPT) {
  const screenshots = filesBelow(runDirectory, (path) => path.toLowerCase().endsWith('.png'));
  const byKey = new Map();
  for (const path of screenshots) {
    const normalized = path.replaceAll('\\', '/');
    const marker = '/takeScreenshot/';
    const markerIndex = normalized.lastIndexOf(marker);
    if (markerIndex >= 0) byKey.set(normalized.slice(markerIndex + marker.length), path);
  }

  return sections.map((section) => {
    const selected = [];
    const fallbacks = [];
    for (const alternatives of section.visuals) {
      const key = alternatives.find((candidate) => byKey.has(candidate));
      if (!key) continue;
      selected.push(byKey.get(key));
      if (key !== alternatives[0]) fallbacks.push({ expected: alternatives[0], selected: key });
    }
    return { ...section, selected, fallbacks };
  });
}

function commandName(command) {
  return Object.keys(command ?? {})[0] ?? 'unknown';
}

/**
 * 从 Maestro commands.json 提取相对于 startRecording 的只读剪辑时间基准。
 */
export function extractCommandTimeline(runDirectory) {
  const commandFiles = filesBelow(runDirectory, (path) => basename(path) === 'commands.json');
  return commandFiles.map((path) => {
    const rows = JSON.parse(readFileSync(path, 'utf8'));
    const recording = rows.find((row) => commandName(row.command) === 'startRecordingCommand');
    const recordingStartedAt = recording?.metadata?.timestamp;
    const commands = rows
      .filter(
        (row) =>
          recordingStartedAt !== undefined &&
          row.metadata?.depth === 0 &&
          row.metadata?.timestamp >= recordingStartedAt,
      )
      .map((row) => ({
        atMs: row.metadata.timestamp - recordingStartedAt,
        durationMs: row.metadata.duration ?? 0,
        status: row.metadata.status,
        action: commandName(row.command),
      }));
    return {
      file: relative(runDirectory, path).replaceAll('\\', '/'),
      commands,
      removableWaits: commands.filter(
        (command) =>
          command.durationMs > 1500 &&
          ['assertConditionCommand', 'runFlowCommand', 'scrollUntilVisible'].includes(
            command.action,
          ),
      ),
    };
  });
}

export function assTimestamp(seconds) {
  const centiseconds = Math.round(seconds * 100);
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const wholeSeconds = Math.floor((centiseconds % 6000) / 100);
  const fraction = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(fraction).padStart(2, '0')}`;
}

function escapeAss(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('{', '\\{').replaceAll('}', '\\}');
}

/**
 * 生成同时承担章节标题、双语字幕、技术栈卡片和 GitHub 结尾的 ASS 文件。
 */
export function renderShowcaseAss(sections = SHOWCASE_SCRIPT) {
  validateShowcaseScript(sections);
  const events = [];
  for (const section of sections) {
    const start = assTimestamp(section.start + 0.25);
    const end = assTimestamp(section.end - 0.25);
    events.push(
      `Dialogue: 0,${start},${end},Title,,0,0,0,,${escapeAss(section.titleZh)}\\N{\\fs28\\c&H8FE7FF&\\b0}${escapeAss(section.titleEn)}`,
    );
    events.push(
      `Dialogue: 0,${assTimestamp(section.start + 0.45)},${assTimestamp(section.end - 0.2)},Subtitle,,0,0,0,,${escapeAss(section.narrationZh)}\\N{\\fs25\\c&HD8E7F5&}${escapeAss(section.subtitleEn)}`,
    );
    if (section.overlay) {
      events.push(
        `Dialogue: 1,${assTimestamp(section.start + 1)},${assTimestamp(section.end - 0.6)},Tech,,0,0,0,,${section.overlay}`,
      );
    }
  }
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,Source Han Sans CN,52,&H00FFFFFF,&H000000FF,&H66020A17,&H00000000,-1,0,0,0,100,100,1,0,1,2,0,7,80,960,92,1
Style: Subtitle,Source Han Sans CN,34,&H00FFFFFF,&H000000FF,&H99020A17,&HCC020A17,0,0,0,0,100,100,0,0,3,1,0,2,120,120,38,1
Style: Tech,Source Han Sans CN,38,&H00FFFFFF,&H000000FF,&H66020A17,&HAA020A17,0,0,0,0,100,100,1,0,3,1,0,4,80,80,236,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`;
}

/**
 * 生成可直接替换旁白或用于面试准备的 Markdown 分镜脚本。
 */
export function renderShowcaseScriptMarkdown(sections = SHOWCASE_SCRIPT) {
  validateShowcaseScript(sections);
  const rows = sections.map(
    (section) =>
      `| ${assTimestamp(section.start).slice(2, 7)}–${assTimestamp(section.end).slice(2, 7)} | ${section.titleZh} | ${section.narrationZh} | ${section.subtitleEn} |`,
  );
  return `# EchoWave 产品演示视频脚本

时长：2 分 30 秒  
画面：1920×1080 / 30fps  
旁白：中文神经 TTS 草稿  
字幕：简体中文主字幕 + 英文副字幕

| 时间 | 章节 | 中文旁白 | English subtitle |
| --- | --- | --- | --- |
${rows.join('\n')}
`;
}
