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
  runRetriableCleanupRequest,
  renderTriageMarkdown,
  selectFlowsFrom,
} from './lib.mjs';
import { SHOWCASE_FLOWS, showcaseNames, suiteFlows } from './suite-config.mjs';

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

test('showcase suite is explicit, ordered, and excluded from the ordinary full regression', () => {
  assert.deepEqual(suiteFlows('showcase'), SHOWCASE_FLOWS);
  assert.deepEqual(suiteFlows('showcase', '03-knowledge-rag'), SHOWCASE_FLOWS.slice(2));
  assert.equal(
    suiteFlows('full').some((flow) => flow.includes('/showcase/')),
    false,
  );
});

test('showcase names are public-friendly and do not expose a run ID', () => {
  const names = showcaseNames(new Date('2026-09-08T08:00:00.000Z'));
  assert.deepEqual(names, {
    audioTitle: 'EchoWave-E2E',
    deviceAudioName: 'EchoWave-E2E.mp3',
    deviceKnowledgeName: 'EchoWave-Product-Brief.md',
    groupName: '产品访谈 · 0908',
    dataSourceName: '用户研究录音 · 0908',
    knowledgeBaseName: '产品研究知识库 · 0908',
  });
  assert.doesNotMatch(JSON.stringify(names), /E2E_[A-Z0-9]/u);
});

test('cleanup retries one transport interruption and records both attempts', async () => {
  let calls = 0;
  const updates = [];
  const body = await runRetriableCleanupRequest({
    stage: 'list-groups',
    url: 'http://127.0.0.1:3201/api/groups?token=secret',
    request: async () => {
      calls += 1;
      if (calls === 1) throw new Error('fetch failed', { cause: new Error('ECONNRESET') });
      return { items: [] };
    },
    onUpdate(operation) {
      updates.push(structuredClone(operation));
    },
  });

  assert.deepEqual(body, { items: [] });
  assert.equal(calls, 2);
  assert.equal(updates.at(-1).status, 'passed');
  assert.deepEqual(updates.at(-1).attempts, [
    { attempt: 1, status: 'failed', causes: ['fetch failed', 'ECONNRESET'] },
    { attempt: 2, status: 'passed' },
  ]);
  assert.equal(updates.at(-1).url, 'http://127.0.0.1:3201/api/groups');
});

test('cleanup exhaustion keeps request context and the nested transport cause', async () => {
  await assert.rejects(
    runRetriableCleanupRequest({
      stage: 'delete-group:42',
      url: 'http://127.0.0.1:3201/api/groups/42?credential=secret',
      options: { method: 'DELETE' },
      request: async () => {
        throw new Error('fetch failed', { cause: new Error('ECONNREFUSED') });
      },
    }),
    (error) => {
      assert.match(error.message, /delete-group:42/u);
      assert.match(error.message, /DELETE http:\/\/127\.0\.0\.1:3201\/api\/groups\/42/u);
      assert.match(error.message, /ECONNREFUSED/u);
      assert.doesNotMatch(error.message, /credential|secret/u);
      assert.equal(error.cleanupOperation.attempts.length, 2);
      return true;
    },
  );
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

test('every top-level Maestro flow uses its shared bootstrap or read-only retake session', () => {
  const flowRoot = join(repoRoot, '.maestro', 'flows');
  for (const path of filesBelow(flowRoot, '.yaml')) {
    assert.match(
      readFileSync(path, 'utf8'),
      path.includes(join('flows', 'showcase-retake'))
        ? /runFlow: \.\.\/\.\.\/subflows\/(open-retake-audio|attach-retake-session)\.yaml/u
        : /runFlow: \.\.\/\.\.\/subflows\/prepare-e2e-app\.yaml/u,
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

test('showcase flows cover the public story and capture the required evidence', () => {
  const source = SHOWCASE_FLOWS.map((flow) =>
    readFileSync(join(repoRoot, '.maestro', flow), 'utf8'),
  ).join('\n');
  for (const marker of [
    'showcase/01-onboarding-completed',
    'showcase/02-analysis-ready',
    'showcase/02-analysis-processing',
    'showcase/02-analysis-completed',
    'showcase/02-report-transcript',
    'showcase/02-report-tasks',
    'showcase/02-report-summary',
    'showcase/02-report-models',
    'showcase/03-answer-with-citation',
    'showcase/03-citation-open',
    'showcase/04-resource-associations',
    'showcase/04-invalid-server',
    'showcase/05-search-result',
    'showcase/05-lifecycle-completed',
  ]) {
    assert.match(source, new RegExp(marker.replaceAll('/', '\\/'), 'u'));
  }
  assert.match(source, /ECHO-4827/u);
  assert.match(source, /SHOWCASE_GROUP_NAME/u);
  assert.doesNotMatch(source, /E2E_\$\{/u);
});

test('root scripts expose showcase recording and rendering explicitly', () => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(
    manifest.scripts['e2e:android:showcase'],
    'node scripts/e2e/android-e2e.mjs showcase',
  );
  assert.equal(manifest.scripts['showcase:video'], 'node scripts/showcase/render-video.mjs');
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
