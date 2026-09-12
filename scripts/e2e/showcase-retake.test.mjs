/**
 * 宣传片补录 Flow 的静态安全与素材契约检查。
 *
 * 检查独立录屏、参数文档和只读命令边界，不替代真实 Android 设备执行。
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import prettier from 'prettier';
import { suiteFlows } from './suite-config.mjs';

const repoRoot = resolve(import.meta.dirname, '../..');
const retakeRoot = resolve(repoRoot, '.maestro/flows/showcase-retake');
const names = [
  '01-transcript-speaker-emotion.yaml',
  '02-business-insights-evidence.yaml',
  '03-knowledge-answer-citation.yaml',
  '04-confirmation-task-status.yaml',
];
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8');
const sources = names.map((name) => readFileSync(resolve(retakeRoot, name), 'utf8'));
const helpers = ['attach-retake-session.yaml', 'open-retake-audio.yaml'].map((name) =>
  read(`.maestro/subflows/${name}`),
);

test('retake YAML parses and only uses bounded read-only commands', async () => {
  assert.deepEqual(
    readdirSync(retakeRoot)
      .filter((name) => name.endsWith('.yaml'))
      .sort(),
    names,
  );
  const allowed = new Set([
    'runFlow',
    'assertTrue',
    'tapOn',
    'assertVisible',
    'assertNotVisible',
    'scrollUntilVisible',
    'extendedWaitUntil',
    'startRecording',
    'takeScreenshot',
    'stopRecording',
    'pressKey',
  ]);
  for (const source of [...sources, ...helpers]) {
    await prettier.format(source, { parser: 'yaml' });
    let descendantsIndent = null;
    for (const line of source.slice(source.indexOf('---') + 3).split(/\r?\n/u)) {
      const indent = line.match(/^\s*/u)[0].length;
      if (line.trim() && descendantsIndent !== null && indent <= descendantsIndent) {
        descendantsIndent = null;
      }
      if (/^\s+containsDescendants:/u.test(line)) descendantsIndent = indent;
      const match = line.match(/^\s*- (\w+)(?::|\s*$)/u);
      if (!match) continue;
      // 后代选择器的文字列表不是 Flow 命令，只在其所属缩进范围内排除。
      if (match[1] === 'text' && descendantsIndent !== null && indent === descendantsIndent + 2) {
        continue;
      }
      assert.ok(allowed.has(match[1]), `unexpected command ${match[1]}`);
    }
    const commands = source.replace(/^\s*#.*$/gmu, '');
    assert.doesNotMatch(
      commands,
      /optional:\s*true|clearState:|https?:\/\/|模型详情|发送问题|重新运行|开始分析|确认整份转写|归档|删除/u,
    );
    assert.doesNotMatch(source, /direction:\s*['"]?\$\{/u);
  }
});

test('each retake has mandatory independent recording and result screenshots', () => {
  const recordings = new Set();
  for (const source of sources) {
    const recording = source.match(/- startRecording:\s*\n\s+path: '([^']+)'/u)?.[1];
    assert.ok(recording);
    assert.ok(!recordings.has(recording));
    recordings.add(recording);
    assert.equal((source.match(/- startRecording:/gu) ?? []).length, 1);
    assert.equal((source.match(/- stopRecording/gu) ?? []).length, 1);
    assert.ok((source.match(/- takeScreenshot: 'retake\//gu) ?? []).length >= 4);
    assert.match(source, /- assertVisible:/u);
  }
});

test('required parameters are documented and provided by their individual commands', () => {
  const documentation = readFileSync(resolve(retakeRoot, 'README.md'), 'utf8');
  for (const source of [...sources, ...helpers]) {
    const params = new Set(source.match(/RETAKE_[A-Z_]+/gu));
    for (const parameter of params) {
      assert.ok(documentation.includes(`\`${parameter}\``), `${parameter} missing parameter table`);
      assert.ok(documentation.includes(`${parameter}=`), `${parameter} missing execution argument`);
    }
  }
  for (const name of names)
    assert.ok(documentation.includes(`maestro test .maestro/flows/showcase-retake/${name}`));
  assert.match(documentation, /不保证每条进入成片/u);
  assert.match(documentation, /未连接 Android 设备/u);
});

test('retakes remain outside default config and runner suites', () => {
  assert.doesNotMatch(read('.maestro/config.yaml'), /showcase-retake/u);
  for (const suite of ['stable', 'real', 'full', 'showcase']) {
    const flows = suiteFlows(suite);
    assert.ok(flows.every((flow) => !flow.includes('showcase-retake')));
  }
  assert.doesNotMatch(helpers.join('\n'), /launchApp|stopApp|openLink|prepare-e2e-app/u);
});

test('hero result selectors correspond to implemented mobile surfaces', () => {
  const translations = read('apps/mobile/src/shared/i18n/translations.ts');
  for (const label of [
    '查看情绪分析详情',
    '情绪分析详情',
    '查看 AI 标签：%{title}',
    '收起 AI 标签面板',
    '块详情',
    '定位原文',
    '展开情绪分析与角色识别',
  ]) {
    assert.ok(translations.includes(`'${label}'`), `missing real UI label ${label}`);
  }
  const transcript = read(
    'apps/mobile/src/features/analysis-detail/components/TranscriptContent.tsx',
  );
  assert.ok(transcript.includes('transcript-timeline-item-segment-${segment.id}'));
  assert.ok(transcript.includes('transcript-emotion-${segment.id}'));
  assert.match(sources[1], /ai-tag-fixed-header/u);
  assert.match(sources[2], /RETAKE_SOURCE_LOCATION_TEXT/u);
  assert.doesNotMatch(sources[2], /inputText|retry|最近问答'\s*\n- tapOn/u);
  assert.match(sources[3], /selected: true/u);
});

test('flattened transcript content is asserted on segment-specific leaf nodes', () => {
  for (const source of sources) assert.doesNotMatch(source, /childOf:|containsDescendants:/u);
  const cases = [
    [
      sources[0],
      'RETAKE_SEGMENT_A_ID',
      [
        ['identity-primary', 'RETAKE_ROLE_A_TEXT'],
        ['identity-secondary', 'RETAKE_SPEAKER_A_TEXT'],
        ['time', 'RETAKE_TIME_A_TEXT'],
      ],
      'time',
    ],
    [
      sources[0],
      'RETAKE_SEGMENT_B_ID',
      [
        ['identity-primary', 'RETAKE_ROLE_B_TEXT'],
        ['identity-secondary', 'RETAKE_SPEAKER_B_TEXT'],
        ['time', 'RETAKE_TIME_B_TEXT'],
      ],
      'time',
    ],
    [
      sources[1],
      'RETAKE_STRENGTH_SEGMENT_ID',
      [['content', 'RETAKE_STRENGTH_EVIDENCE_TEXT']],
      'content',
    ],
    [
      sources[1],
      'RETAKE_IMPROVEMENT_SEGMENT_ID',
      [['content', 'RETAKE_IMPROVEMENT_EVIDENCE_TEXT']],
      'content',
    ],
  ];
  const transcript = read(
    'apps/mobile/src/features/analysis-detail/components/TranscriptContent.tsx',
  );
  for (const [source, id, fields, anchorField] of cases) {
    const selector = `id: 'transcript-${anchorField}-\${${id}}'`;
    const scrolls = source
      .split('- scrollUntilVisible:')
      .slice(1)
      .map((block) => block.split('\n- ')[0]);
    const scroll = scrolls.find((block) => block.includes(selector));
    assert.ok(scroll, `${id} needs a visible content anchor`);
    // 直接按叶节点 ID 滚动，可见即停止，不让长复核卡片改变锚点。
    assert.match(scroll, /element:\s*\n\s+id:/u);
    assert.match(scroll, /centerElement: false/u);
    assert.doesNotMatch(scroll, /text:|transcript-timeline-item-segment-/u);
    const assertions = source
      .split('- assertVisible:')
      .slice(1)
      .map((block) => block.split('\n- ')[0]);
    for (const [field, text] of fields) {
      assert.ok(transcript.includes(`testID={\`transcript-${field}-\${segment.id}\`}`));
      const assertion = assertions.find((block) =>
        block.includes(`id: 'transcript-${field}-\${${id}}'`),
      );
      assert.ok(assertion, `${id} needs explicit ${field} assertion`);
      assert.ok(assertion.includes(`text: '\${${text}}'`));
    }
  }
  const emotionTaps = sources[0]
    .split('- tapOn:')
    .slice(1)
    .map((block) => block.split('\n- ')[0])
    .filter((block) => block.includes('transcript-emotion-'));
  assert.equal(emotionTaps.length, 2);
  for (const [index, label] of ['A', 'B'].entries()) {
    const block = emotionTaps[index];
    assert.match(block, /enabled: true/u);
    const selector = `id: 'transcript-emotion-\${RETAKE_SEGMENT_${label}_ID}'`;
    assert.ok(block.includes(selector));
    assert.doesNotMatch(block, /below:|above:|index:|point:/u);
    const assertion = sources[0]
      .split('- assertVisible:')
      .find((entry) => entry.includes(selector));
    assert.ok(assertion);
    assert.match(assertion, /text: '查看情绪分析详情'\s+enabled: true/u);
  }
});

test('native sibling fixture rejects container descendants and wrong-segment text', () => {
  // 仅使用脱敏结构样例；这里检查标识归属，不模拟完整 Maestro 可见性算法。
  const tree = JSON.parse(read('.maestro/fixtures/showcase-retake.flattened-hierarchy.json'));
  const nodes = tree.children;
  const container = nodes.find(
    (node) => node.attributes['resource-id'] === 'transcript-timeline-item-segment-segment-a',
  );
  assert.equal(container.children, null);
  const select = (id, text) =>
    nodes.filter(
      (node) =>
        node.attributes['resource-id'] === id &&
        (node.attributes.text === text || node.attributes.accessibilityText === text),
    );
  assert.equal(nodes.filter((node) => node.attributes.text === '客户').length, 2);
  assert.equal(select('transcript-identity-primary-segment-a', '客户').length, 1);
  assert.equal(
    select('transcript-identity-secondary-segment-a', 'Speaker 1 · 角色置信度 95%').length,
    0,
  );
  assert.equal(select('transcript-content-segment-a', '结构测试正文 B').length, 0);
  assert.equal(select('transcript-content-segment-b', '结构测试正文 B').length, 1);
  for (const segment of ['a', 'b']) {
    assert.equal(select(`transcript-emotion-segment-${segment}`, '查看情绪分析详情').length, 1);
  }
});
