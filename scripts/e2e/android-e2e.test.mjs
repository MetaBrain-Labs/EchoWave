import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  collectExactCleanupTargets,
  createRunId,
  isMetroStatusHealthy,
  isValidRunId,
  parseEnvPort,
  parseAdbDevices,
  parseArgs,
  renderTriageMarkdown,
  selectFlowsFrom,
} from './lib.mjs';

const repoRoot = resolve(import.meta.dirname, '..', '..');

function filesBelow(directory, extension) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? filesBelow(path, extension)
      : entry.name.endsWith(extension)
        ? [path]
        : [];
  });
}

test('parseArgs accepts pnpm separators and named values', () => {
  assert.deepEqual(parseArgs(['repair', '--', '--run', 'E2E_X', '--confirm=E2E_X']), {
    positionals: ['repair'],
    options: { run: 'E2E_X', confirm: 'E2E_X' },
  });
});

test('parseEnvPort reads the API port from quoted or plain env values', () => {
  assert.equal(parseEnvPort('PORT=3001\n'), 3001);
  assert.equal(parseEnvPort('PORT="3201" # local API\n'), 3201);
});

test('run IDs are ASCII, unique-friendly, and strictly validated', () => {
  const runId = createRunId(new Date('2026-09-06T01:02:03.000Z'), 'a1b2c3');
  assert.equal(runId, 'E2E_20260906T010203Z_A1B2C3');
  assert.equal(isValidRunId(runId), true);
  assert.equal(isValidRunId('E2E_*'), false);
});

test('parseAdbDevices preserves unauthorized states', () => {
  assert.deepEqual(parseAdbDevices('List of devices attached\nABC\tdevice\nDEF\tunauthorized\n'), [
    { serial: 'ABC', state: 'device' },
    { serial: 'DEF', state: 'unauthorized' },
  ]);
});

test('selectFlowsFrom starts a fresh run at an exact flow basename', () => {
  const flows = [
    'flows/stable/01-bootstrap-navigation.yaml',
    'flows/stable/02-resource-crud.yaml',
    'flows/stable/03-seeded-analysis.yaml',
  ];
  assert.deepEqual(selectFlowsFrom(flows, '02-resource-crud'), flows.slice(1));
  assert.deepEqual(selectFlowsFrom(flows, undefined), flows);
  assert.throws(() => selectFlowsFrom(flows, '02'), /未知起始 Flow/u);
});

test('Metro readiness does not accept an IPv6 localhost fallback for the adb reverse endpoint', async () => {
  const requestedUrls = [];
  const healthy = await isMetroStatusHealthy('http://127.0.0.1:8081/status', async (url) => {
    requestedUrls.push(url);
    if (url === 'http://localhost:8081/status') {
      return { ok: true, text: async () => 'packager-status:running' };
    }
    throw new Error('IPv4 endpoint is unavailable');
  });

  assert.equal(healthy, false);
  assert.deepEqual(requestedUrls, ['http://127.0.0.1:8081/status']);
});

test('cleanup only selects exact names recorded by the run', () => {
  const targets = collectExactCleanupTargets(
    {
      groups: [
        { id: '1', name: 'E2E_exact' },
        { id: '2', name: 'E2E_exact_extra' },
      ],
      dataSources: [{ id: '3', name: 'E2E_source' }],
      knowledgeBases: [{ id: '4', name: '用户知识库' }],
    },
    {
      createdResources: {
        groupNames: ['E2E_exact'],
        dataSourceNames: ['E2E_source'],
        knowledgeBaseNames: [],
      },
    },
  );

  assert.deepEqual(
    targets.groups.map(({ id }) => id),
    ['1'],
  );
  assert.deepEqual(
    targets.dataSources.map(({ id }) => id),
    ['3'],
  );
  assert.deepEqual(targets.knowledgeBases, []);
});

test('triage markdown renders the fixed diagnostic contract', () => {
  const markdown = renderTriageMarkdown({
    classification: 'application',
    confidence: 'high',
    needsUserAction: false,
    likelyRootCause: '按钮未响应。',
    failingFlows: ['stable-navigation'],
    failedSteps: ['tapOn'],
    evidence: ['commands.json'],
    reproduction: ['运行稳定套件'],
    proposedFiles: ['apps/mobile/example.tsx'],
    proposedChanges: ['修复回调'],
    verificationCommands: ['pnpm e2e:android'],
    userAction: '',
  });
  assert.match(markdown, /分类：application/u);
  assert.match(markdown, /pnpm e2e:android/u);
});

test('every top-level Maestro flow normalizes the app through the shared bootstrap', () => {
  const flowRoot = join(repoRoot, '.maestro', 'flows');
  for (const path of filesBelow(flowRoot, '.yaml')) {
    assert.match(
      readFileSync(path, 'utf8'),
      /runFlow: \.\.\/\.\.\/subflows\/prepare-e2e-app\.yaml/u,
      `${path} must use the shared app bootstrap`,
    );
  }
});

test('Maestro recordings remain inside each flow artifact directory', () => {
  const flowRoot = join(repoRoot, '.maestro', 'flows');
  for (const path of filesBelow(flowRoot, '.yaml')) {
    const source = readFileSync(path, 'utf8');
    const recordingPath = source.match(/- startRecording:\s*\r?\n\s+path:\s*'([^']+)'/u)?.[1];
    assert.ok(recordingPath, `${path} must configure a recording path`);
    assert.doesNotMatch(recordingPath, /(^|[\\/])\.\.([\\/]|$)/u, `${path} recording escapes`);
  }
});

test('system file picker subflows confirm multi-select providers when required', () => {
  for (const name of ['select-audio-file.yaml', 'select-knowledge-file.yaml']) {
    const source = readFileSync(join(repoRoot, '.maestro', 'subflows', name), 'utf8');
    assert.match(source, /visible: '确定\|OK\|Open'/u);
    assert.match(source, /tapOn: '确定\|OK\|Open'/u);
  }
});

test('stable audio upload waits for ingestion before asserting the audio list title', () => {
  const source = readFileSync(
    join(repoRoot, '.maestro', 'flows', 'stable', '02-resource-crud.yaml'),
    'utf8',
  );
  const uploadSucceeded = source.indexOf("visible: '上传成功'");
  const audioTab = source.indexOf("id: 'data-source-tab-audio'");
  const audioTitle = source.indexOf("text: '${AUDIO_TITLE}'", audioTab);
  assert.ok(uploadSucceeded >= 0 && uploadSucceeded < audioTab);
  assert.ok(audioTab < audioTitle);
});

test('stable source search keeps controls visible while the keyboard is open', () => {
  const source = readFileSync(
    join(repoRoot, '.maestro', 'flows', 'stable', '02-resource-crud.yaml'),
    'utf8',
  );
  const firstSearch = source.indexOf("- tapOn: '搜索数据源内容'");
  const firstInput = source.indexOf("- tapOn: '输入数据源内容搜索关键词'", firstSearch);
  const firstScreenshot = source.indexOf('stable/02-search-keyboard-visible', firstSearch);
  const executeSearch = source.indexOf("- tapOn: '执行搜索'", firstSearch);
  const secondSearch = source.indexOf("- tapOn: '搜索数据源内容'", executeSearch);
  const secondInput = source.indexOf("- assertVisible: '输入数据源内容搜索关键词'", secondSearch);
  const clearSearch = source.indexOf("- tapOn: '清除搜索'", secondSearch);
  assert.ok(firstSearch >= 0 && firstSearch < firstScreenshot);
  assert.ok(firstScreenshot < firstInput && firstInput < executeSearch);
  assert.ok(secondSearch >= 0 && secondSearch < secondInput && secondInput < clearSearch);
  assert.doesNotMatch(source.slice(secondSearch, clearSearch), /- hideKeyboard/u);
});

test('stable source edit checks the updated description on the overview tab', () => {
  const source = readFileSync(
    join(repoRoot, '.maestro', 'flows', 'stable', '02-resource-crud.yaml'),
    'utf8',
  );
  const editDialog = source.indexOf("- tapOn: '编辑数据源'");
  const save = source.indexOf("- tapOn: '确认'", editDialog);
  const overviewTab = source.indexOf("id: 'data-source-tab-overview'", save);
  const editedDescription = source.indexOf("- assertVisible: 'E2E source edited'", save);
  assert.ok(editDialog >= 0 && editDialog < save);
  assert.ok(save < overviewTab && overviewTab < editedDescription);
});

test('stable source edit writes into an empty description field', () => {
  const source = readFileSync(
    join(repoRoot, '.maestro', 'flows', 'stable', '02-resource-crud.yaml'),
    'utf8',
  );
  const editDialog = source.indexOf("- tapOn: '编辑数据源'");
  const description = source.indexOf("- tapOn: '数据源描述'", editDialog);
  const replacement = source.indexOf("- inputText: 'E2E source edited'", description);
  const save = source.indexOf("- tapOn: '确认'", replacement);
  assert.ok(editDialog >= 0 && editDialog < description);
  assert.ok(description < replacement && replacement < save);
  assert.doesNotMatch(
    source.slice(description, replacement),
    /eraseText|longPressOn|全选|Select all/u,
  );
});

test('invalid server flow stops after the recoverable cancellation state', () => {
  const source = readFileSync(
    join(repoRoot, '.maestro', 'flows', 'stable', '04-lifecycle-errors.yaml'),
    'utf8',
  );
  const screenshot = source.indexOf('stable/04-invalid-server');
  const cancel = source.indexOf("id: '取消修改服务器'");
  const stop = source.indexOf('- stopRecording');
  assert.ok(screenshot >= 0 && screenshot < cancel && cancel < stop);
  assert.doesNotMatch(source.slice(cancel), /pressKey: HOME|launchApp|e2e-tab-more/u);
});

test('android runner cleans child process trees even after wrapper exit and on termination signals', () => {
  const source = readFileSync(join(repoRoot, 'scripts', 'e2e', 'android-e2e.mjs'), 'utf8');
  assert.doesNotMatch(source, /child\.exitCode !== null \|\| !child\.pid/u);
  assert.match(source, /process\.once\('SIGINT'/u);
  assert.match(source, /process\.once\('SIGTERM'/u);
  assert.match(source, /cleanupStartedProcesses\(\);\s*console\.error\(`E2E 失败/u);
  assert.match(source, /activeProcessCleanup = cleanupStartedProcesses/u);
});

test('onboarding validation uses seeded selections after the validation alert', () => {
  const source = readFileSync(
    join(repoRoot, '.maestro', 'flows', 'stable', '05-onboarding-validation.yaml'),
    'utf8',
  );
  const createTab = source.indexOf("id: 'e2e-tab-create'");
  const batchAction = source.indexOf("- tapOn: '上传并开始全流程'", createTab);
  assert.ok(createTab >= 0 && createTab < batchAction);
  assert.doesNotMatch(source.slice(createTab, batchAction), /scrollUntilVisible/u);

  const validationAlert = source.indexOf("- tapOn: 'OK'");
  const sourceScroll = source.indexOf("text: '市场调研资料'", validationAlert);
  const sourceTap = source.indexOf("- tapOn: '市场调研资料'", validationAlert);
  const groupTap = source.indexOf("- tapOn: '市场洞察组'", sourceTap);
  assert.ok(validationAlert >= 0 && validationAlert < sourceScroll);
  assert.ok(sourceScroll < sourceTap && sourceTap < groupTap);
  assert.doesNotMatch(
    source.slice(validationAlert, groupTap),
    /\$\{SOURCE_NAME\}|\$\{GROUP_NAME\}/u,
  );
});

test('static Maestro id selectors are backed by mobile test IDs', () => {
  const maestroSource = filesBelow(join(repoRoot, '.maestro'), '.yaml')
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
  const mobileSource = filesBelow(join(repoRoot, 'apps', 'mobile', 'src'), '.tsx')
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
  const selectors = [...maestroSource.matchAll(/^\s+id:\s*'([^']+)'/gmu)]
    .flatMap((match) => match[1].split('|'))
    .filter((id) => !id.includes('${'));

  for (const id of selectors) {
    const literal = mobileSource.includes(`'${id}'`) || mobileSource.includes(`"${id}"`);
    const composedTab = id.match(/^(.*-tab)-([a-z]+)$/u);
    const composed =
      composedTab &&
      mobileSource.includes(`testIDPrefix="${composedTab[1]}"`) &&
      mobileSource.includes(`key: '${composedTab[2]}'`);
    assert.ok(literal || composed, `Maestro id ${id} has no mobile testID contract`);
  }
});
