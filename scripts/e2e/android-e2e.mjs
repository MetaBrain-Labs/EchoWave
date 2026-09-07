import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertValidRunId,
  collectExactCleanupTargets,
  createRunId,
  isMetroStatusHealthy,
  parseEnvPort,
  parseAdbDevices,
  parseArgs,
  renderHtmlReport,
  renderTriageMarkdown,
  selectFlowsFrom,
} from './lib.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');
const artifactsRoot = join(repoRoot, '.artifacts', 'maestro');
const maestroRoot = join(repoRoot, '.maestro');
const appId = 'com.echowave.app';
const apiPort = parseEnvPort(readFileSync(join(repoRoot, 'apps', 'api', '.env'), 'utf8'));
const serverUrl = `http://127.0.0.1:${apiPort}`;
const metroPort = 8081;
const metroUrl = `http://127.0.0.1:${metroPort}`;
const audioFixture = join(
  repoRoot,
  'apps',
  'api',
  '.data',
  'audio',
  '74f0d9e3-1adc-4d35-8737-215558532046.mp3',
);
const knowledgeFixture = join(maestroRoot, 'fixtures', 'echowave-e2e-knowledge.md');

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function commandScript(command, args) {
  return `& ${psQuote(command)} ${args.map(psQuote).join(' ')}`;
}

function runPowerShell(script, options = {}) {
  const result = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    {
      cwd: options.cwd ?? repoRoot,
      encoding: 'utf8',
      env: { ...process.env, ...options.env },
      maxBuffer: 32 * 1024 * 1024,
      stdio: options.inherit ? 'inherit' : 'pipe',
      input: options.input,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`命令失败 (${result.status})：${script}\n${details}`);
  }
  return result;
}

function resolveCommand(name) {
  const result = runPowerShell(
    `$command = Get-Command ${psQuote(name)} -ErrorAction SilentlyContinue; if ($command) { $command.Source }`,
    { allowFailure: true },
  );
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/u).at(-1)?.trim() || null : null;
}

function runCommand(command, args, options = {}) {
  return runPowerShell(commandScript(command, args), options);
}

function startLoggedProcess(command, args, logPath, env = {}) {
  mkdirSync(dirname(logPath), { recursive: true });
  const log = createWriteStream(logPath, { flags: 'a' });
  const child = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', commandScript(command, args)],
    {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.on('exit', () => log.end());
  return child;
}

function stopProcessTree(child) {
  const rootPid = Number(child?.pid);
  if (!Number.isInteger(rootPid) || rootPid <= 0) return;
  // PowerShell 包装进程可能已经退出，但 pnpm/Node 子进程仍然占用端口；不能用 exitCode 提前跳过进程树清理。
  const script = `$rootPid = ${rootPid}; function Stop-ChildTree([int]$parentId) { $children = @(Get-CimInstance Win32_Process -Filter \"ParentProcessId = $parentId\"); foreach ($childProcess in $children) { Stop-ChildTree ([int]$childProcess.ProcessId); Stop-Process -Id ([int]$childProcess.ProcessId) -Force -ErrorAction SilentlyContinue } }; Stop-ChildTree $rootPid; Stop-Process -Id $rootPid -Force -ErrorAction SilentlyContinue`;
  runPowerShell(script, {
    allowFailure: true,
  });
}

let activeProcessCleanup = null;
let terminationRequested = false;

function handleTerminationSignal(signal) {
  if (terminationRequested) return;
  terminationRequested = true;
  console.error(`收到 ${signal}，正在终止本次 E2E 启动的 API、Metro 和日志进程。`);
  try {
    activeProcessCleanup?.();
  } finally {
    const exitCode = signal === 'SIGINT' ? 130 : 143;
    // 注册信号监听后 Node 不会再执行 Windows 默认退出行为，必须显式结束主进程。
    process.exitCode = exitCode;
    process.exit(exitCode);
  }
}

process.once('SIGINT', () => handleTerminationSignal('SIGINT'));
process.once('SIGTERM', () => handleTerminationSignal('SIGTERM'));

async function fetchJson(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  if (response.status === 204) return null;
  return response.json();
}

async function isHealthy(url, predicate = () => true) {
  try {
    return predicate(await fetchJson(url));
  } catch {
    return false;
  }
}

async function isMetroHealthy() {
  // readiness 必须验证设备经 adb reverse 实际访问的 IPv4 传输端点，不能由 IPv6 localhost 代替。
  return isMetroStatusHealthy(`${metroUrl}/status`);
}

async function isTcpPortOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(1_000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitUntil(check, description, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  throw new Error(`等待超时：${description}`);
}

function requireValue(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function readPackageVersion(command, args = ['--version']) {
  const result = runCommand(command, args, { allowFailure: true });
  return result.status === 0 ? result.stdout.trim() || result.stderr.trim() : null;
}

async function inspectEnvironment({ requireRunningServices = false, requireCodex = false } = {}) {
  const checks = [];
  const add = (name, ok, detail, required = true) => checks.push({ name, ok, detail, required });
  const java = resolveCommand('java');
  const pnpm = resolveCommand('pnpm');
  const maestro = resolveCommand('maestro');
  const adb = resolveCommand('adb');
  const codex = resolveCommand('codex');

  add('Windows', process.platform === 'win32', process.platform);
  add('Node.js 24', Number(process.versions.node.split('.')[0]) === 24, process.version);
  add('pnpm', Boolean(pnpm), pnpm ? readPackageVersion(pnpm) : '未找到');
  add('Java 17+', Boolean(java), java ? readPackageVersion(java, ['-version']) : '未找到');
  if (java) {
    const javaResult = runCommand(java, ['-version'], { allowFailure: true });
    const versionText = `${javaResult.stdout}\n${javaResult.stderr}`;
    const major = Number(versionText.match(/version "(?:1\.)?(\d+)/u)?.[1] ?? 0);
    checks[checks.length - 1].ok = major >= 17;
    checks[checks.length - 1].detail = versionText.trim().split(/\r?\n/u)[0] ?? '未知版本';
  }
  add('Maestro CLI', Boolean(maestro), maestro ? readPackageVersion(maestro) : '未找到');
  add('Android ADB', Boolean(adb), adb ? readPackageVersion(adb) : '未找到');
  add('Codex CLI', Boolean(codex), codex ? readPackageVersion(codex) : '未找到', requireCodex);
  add('测试音频', existsSync(audioFixture), relative(repoRoot, audioFixture));
  add('知识文档', existsSync(knowledgeFixture), relative(repoRoot, knowledgeFixture));

  let serial = null;
  if (adb) {
    const devices = parseAdbDevices(runCommand(adb, ['devices']).stdout);
    const authorized = devices.filter(({ state }) => state === 'device');
    const deviceOk = authorized.length === 1 && devices.length === 1;
    add(
      '唯一已授权 Android 设备',
      deviceOk,
      devices.length
        ? devices.map(({ serial: id, state }) => `${id}:${state}`).join(', ')
        : '无设备',
    );
    if (deviceOk) {
      serial = authorized[0].serial;
      const packageResult = runCommand(adb, ['-s', serial, 'shell', 'pm', 'path', appId], {
        allowFailure: true,
      });
      add(
        'E2E Development Build',
        packageResult.status === 0,
        packageResult.stdout.trim() || '未安装',
      );
    }
  }

  const apiHealthy = await isHealthy(`${serverUrl}/health`, (body) => body.status === 'ok');
  const metroHealthy = await isMetroHealthy();
  add(
    'API /health',
    apiHealthy,
    apiHealthy ? serverUrl : '未运行；执行套件时会启动',
    requireRunningServices,
  );
  add(
    'Metro 8081',
    metroHealthy,
    metroHealthy ? metroUrl : '未运行；执行套件时会启动',
    requireRunningServices,
  );

  return { checks, commands: { adb, codex, java, maestro, pnpm }, serial };
}

function printChecks(checks) {
  for (const check of checks) {
    const marker = check.ok ? 'PASS' : check.required ? 'FAIL' : 'WARN';
    console.log(`[${marker}] ${check.name}: ${check.detail}`);
  }
}

function assertRequiredChecks(checks) {
  const failures = checks.filter((check) => check.required && !check.ok);
  if (failures.length) {
    throw new Error(`前置检查失败：${failures.map(({ name }) => name).join('、')}`);
  }
}

function suiteFlows(suite, fromFlow) {
  const stable = [
    'flows/stable/01-bootstrap-navigation.yaml',
    'flows/stable/02-resource-crud.yaml',
    'flows/stable/03-seeded-analysis.yaml',
    'flows/stable/04-lifecycle-errors.yaml',
    'flows/stable/05-onboarding-validation.yaml',
    'flows/stable/06-settings-archive.yaml',
  ];
  const real = [
    'flows/real/01-audio-analysis.yaml',
    'flows/real/02-knowledge-rag.yaml',
    'flows/real/03-push-capability.yaml',
  ];
  const flows = suite === 'stable' ? stable : suite === 'real' ? real : [...stable, ...real];
  return selectFlowsFrom(flows, fromFlow);
}

function contextFor(runId, suite) {
  const suffix = runId.slice(-6);
  return {
    runId,
    suite,
    appId,
    startedAt: new Date().toISOString(),
    serverUrl,
    metroUrl,
    deviceAudioName: 'EchoWave-E2E.mp3',
    audioTitle: 'EchoWave-E2E',
    deviceKnowledgeName: 'EchoWave-E2E-Knowledge.md',
    stableGroupName: `E2E_${suffix}_GROUP`,
    stableDataSourceName: `E2E_${suffix}_SOURCE`,
    stableKnowledgeBaseName: `E2E_${suffix}_KB`,
    realGroupName: `E2E_${suffix}_REAL_GROUP`,
    realDataSourceName: `E2E_${suffix}_REAL_SOURCE`,
    realKnowledgeBaseName: `E2E_${suffix}_REAL_KB`,
    createdResources: {
      groupNames: [`E2E_${suffix}_GROUP`, `E2E_${suffix}_REAL_GROUP`],
      dataSourceNames: [`E2E_${suffix}_SOURCE`, `E2E_${suffix}_REAL_SOURCE`],
      knowledgeBaseNames: [`E2E_${suffix}_KB`, `E2E_${suffix}_REAL_KB`],
    },
  };
}

function maestroEnvironment(context) {
  return {
    RUN_ID: context.runId,
    SERVER_URL: context.serverUrl,
    METRO_URL: context.metroUrl,
    DEVICE_AUDIO_NAME: context.deviceAudioName,
    AUDIO_TITLE: context.audioTitle,
    DEVICE_KNOWLEDGE_NAME: context.deviceKnowledgeName,
    GROUP_NAME: context.stableGroupName,
    SOURCE_NAME: context.stableDataSourceName,
    KB_NAME: context.stableKnowledgeBaseName,
    REAL_GROUP_NAME: context.realGroupName,
    REAL_SOURCE_NAME: context.realDataSourceName,
    REAL_KB_NAME: context.realKnowledgeBaseName,
  };
}

async function prepareServices(commands, runDir, started) {
  runCommand(commands.pnpm, ['--filter', '@echowave/contracts', 'build'], { inherit: true });
  runCommand(commands.pnpm, ['--filter', '@echowave/api', 'migrate'], { inherit: true });
  runCommand(commands.pnpm, ['--filter', '@echowave/api', 'seed:dev'], { inherit: true });

  if (!(await isHealthy(`${serverUrl}/health`, (body) => body.status === 'ok'))) {
    if (await isTcpPortOpen(apiPort)) {
      throw new Error(
        `EchoWave API 未通过 /health，但端口 ${apiPort} 已被占用；请关闭占用该端口的进程后重试。`,
      );
    }
    const api = startLoggedProcess(
      commands.pnpm,
      ['--filter', '@echowave/api', 'dev'],
      join(runDir, 'api.log'),
    );
    started.push(api);
    await waitUntil(
      () => isHealthy(`${serverUrl}/health`, (body) => body.status === 'ok'),
      'EchoWave API /health',
    );
  } else {
    writeFileSync(join(runDir, 'api.log'), '复用运行中的 API；未捕获其历史日志。\n');
  }

  if (!(await isMetroHealthy())) {
    if (await isTcpPortOpen(metroPort)) {
      throw new Error(
        `Expo Metro 未通过 /status，但端口 ${metroPort} 已被占用；请关闭占用该端口的进程后重试。`,
      );
    }
    const metro = startLoggedProcess(
      commands.pnpm,
      [
        '--filter',
        '@echowave/mobile',
        'exec',
        'expo',
        'start',
        '--dev-client',
        '--lan',
        '--port',
        String(metroPort),
      ],
      join(runDir, 'metro.log'),
      { EXPO_PUBLIC_REQUIRE_SERVER_SELECTION: 'true', EXPO_NO_TELEMETRY: '1' },
    );
    started.push(metro);
    await waitUntil(
      () => {
        if (metro.exitCode !== null || metro.signalCode !== null) {
          throw new Error(
            `Expo Metro 在 readiness 完成前退出（exitCode=${String(metro.exitCode)}, signal=${String(metro.signalCode)}）；请检查 ${join(runDir, 'metro.log')}。`,
          );
        }
        return isMetroHealthy();
      },
      'Expo Metro 127.0.0.1:8081/status',
      120_000,
    );
  } else {
    writeFileSync(join(runDir, 'metro.log'), '复用运行中的 Metro；未捕获其历史日志。\n');
  }
}

function prepareDevice(adb, serial) {
  for (const port of [String(apiPort), String(metroPort)]) {
    runCommand(adb, ['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
  }
  runCommand(adb, ['-s', serial, 'push', audioFixture, '/sdcard/Download/EchoWave-E2E.mp3']);
  runCommand(adb, [
    '-s',
    serial,
    'push',
    knowledgeFixture,
    '/sdcard/Download/EchoWave-E2E-Knowledge.md',
  ]);
  for (const devicePath of [
    '/sdcard/Download/EchoWave-E2E.mp3',
    '/sdcard/Download/EchoWave-E2E-Knowledge.md',
  ]) {
    runCommand(adb, [
      '-s',
      serial,
      'shell',
      'am',
      'broadcast',
      '-a',
      'android.intent.action.MEDIA_SCANNER_SCAN_FILE',
      '-d',
      `file://${devicePath}`,
    ]);
  }
}

async function cleanupRunResources(context, runDir) {
  const list = async (path) => {
    const body = await fetchJson(`${serverUrl}${path}`);
    return Array.isArray(body) ? body : (body.items ?? []);
  };
  const targets = collectExactCleanupTargets(
    {
      groups: await list('/api/groups'),
      dataSources: await list('/api/data-sources'),
      knowledgeBases: await list('/api/knowledge-bases'),
    },
    context,
  );
  const cleaned = { audioFiles: [], dataSources: [], knowledgeBases: [], groups: [] };

  for (const source of targets.dataSources) {
    const audioBody = await fetchJson(
      `${serverUrl}/api/data-sources/${encodeURIComponent(source.id)}/audio-files`,
    );
    for (const audio of audioBody.items ?? audioBody) {
      await fetchJson(
        `${serverUrl}/api/data-sources/${encodeURIComponent(source.id)}/audio-files/${encodeURIComponent(audio.id)}`,
        { method: 'DELETE' },
      );
      cleaned.audioFiles.push(audio.id);
    }
    await fetchJson(`${serverUrl}/api/data-sources/${encodeURIComponent(source.id)}`, {
      method: 'DELETE',
    });
    cleaned.dataSources.push(source.id);
  }
  for (const knowledgeBase of targets.knowledgeBases) {
    await fetchJson(`${serverUrl}/api/knowledge-bases/${encodeURIComponent(knowledgeBase.id)}`, {
      method: 'DELETE',
    });
    cleaned.knowledgeBases.push(knowledgeBase.id);
  }
  for (const group of targets.groups) {
    await fetchJson(`${serverUrl}/api/groups/${encodeURIComponent(group.id)}`, {
      method: 'DELETE',
    });
    cleaned.groups.push(group.id);
  }
  writeFileSync(join(runDir, 'cleanup.json'), `${JSON.stringify(cleaned, null, 2)}\n`);
}

function newestPngs(root, limit = 3) {
  if (!existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.name.toLowerCase().endsWith('.png')) files.push(fullPath);
    }
  };
  visit(root);
  return files
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
    .slice(0, limit);
}

function runTriage(runId, codexCommand) {
  assertValidRunId(runId);
  const runDir = join(artifactsRoot, runId);
  requireValue(existsSync(runDir), `找不到运行目录：${runDir}`);
  const codex = codexCommand ?? requireValue(resolveCommand('codex'), '未找到 Codex CLI。');
  const schemaPath = join(scriptDir, 'triage-schema.json');
  const triageJson = join(runDir, 'triage.json');
  const prompt = `你是 EchoWave Android E2E 的只读诊断员。检查 ${runDir} 下的失败 Flow、JUnit、commands JSON、Maestro/API/Metro/logcat 日志、context.json 和 git-status.txt，并结合 ${repoRoot} 当前源码判断根因。只输出符合给定 JSON Schema 的诊断。禁止编辑任何文件，禁止弱化断言、跳过失败 Flow 或把固定 sleep 当成修复。证据必须指向具体文件或日志内容，建议采用最小修复。`;
  const args = [
    'exec',
    '--ephemeral',
    '--sandbox',
    'read-only',
    '-C',
    repoRoot,
    '--output-schema',
    schemaPath,
    '-o',
    triageJson,
  ];
  for (const screenshot of newestPngs(runDir)) args.push('-i', screenshot);
  args.push('-');
  const result = runCommand(codex, args, { allowFailure: true, input: prompt });
  writeFileSync(join(runDir, 'codex-triage.log'), `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  if (result.status !== 0 || !existsSync(triageJson)) {
    throw new Error(`Codex 只读诊断失败，详情见 ${join(runDir, 'codex-triage.log')}`);
  }
  const triage = JSON.parse(readFileSync(triageJson, 'utf8'));
  writeFileSync(join(runDir, 'triage.md'), renderTriageMarkdown(triage));
  console.log(`诊断已保存：${join(runDir, 'triage.md')}`);
}

function runRepair(runId, confirmation, codexCommand) {
  assertValidRunId(runId);
  if (confirmation !== runId) {
    throw new Error('repair 被拒绝：--confirm 必须与 --run 完全一致。');
  }
  const runDir = join(artifactsRoot, runId);
  const triagePath = join(runDir, 'triage.json');
  requireValue(existsSync(triagePath), `缺少已审核的诊断：${triagePath}`);
  const codex = codexCommand ?? requireValue(resolveCommand('codex'), '未找到 Codex CLI。');
  const outputPath = join(runDir, 'repair.md');
  const prompt = `用户已通过精确运行 ID ${runId} 确认修复。阅读 ${triagePath} 和 ${runDir} 的失败证据，在 ${repoRoot} 保留当前脏工作树和既有修改，只实现诊断中已确认的最小修复。应用缺陷才修改业务代码；测试、设备、环境或供应商问题不得通过改业务逻辑掩盖。禁止弱化断言、跳过失败 Flow 或加入任意 sleep。先重跑失败 Flow，再跑其 stable/real 分组；若修改源码，遵循 AGENTS.md，只运行一次 pnpm format，然后 git diff --check 和最终 pnpm check。最后输出修改、验证和遗留问题摘要。`;
  const result = runCommand(
    codex,
    ['exec', '--ephemeral', '--sandbox', 'workspace-write', '-C', repoRoot, '-o', outputPath, '-'],
    { allowFailure: true, inherit: false, input: prompt },
  );
  writeFileSync(join(runDir, 'codex-repair.log'), `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  if (result.status !== 0)
    throw new Error(`Codex repair 失败，详情见 ${join(runDir, 'codex-repair.log')}`);
  console.log(`修复摘要已保存：${outputPath}`);
}

async function runSuite(suite, fromFlow) {
  const flows = suiteFlows(suite, fromFlow);
  const runId = createRunId();
  const runDir = join(artifactsRoot, runId);
  mkdirSync(runDir, { recursive: true });
  const context = contextFor(runId, suite);
  context.fromFlow = fromFlow || null;
  writeFileSync(join(runDir, 'context.json'), `${JSON.stringify(context, null, 2)}\n`);

  const environment = await inspectEnvironment();
  printChecks(environment.checks);
  writeFileSync(join(runDir, 'preflight.json'), `${JSON.stringify(environment.checks, null, 2)}\n`);
  assertRequiredChecks(environment.checks);
  const { adb, maestro, pnpm } = environment.commands;
  const serial = requireValue(environment.serial, '没有唯一已授权设备。');
  const started = [];
  let logcat = null;
  const summary = { runId, suite, fromFlow: fromFlow || null, status: 'failed', flows: [] };
  const cleanupStartedProcesses = () => {
    if (logcat) {
      stopProcessTree(logcat);
      logcat = null;
    }
    for (const child of started.splice(0).reverse()) stopProcessTree(child);
  };
  activeProcessCleanup = cleanupStartedProcesses;

  try {
    if (suite === 'full') runCommand(pnpm, ['check'], { inherit: true });
    await prepareServices(environment.commands, runDir, started);
    prepareDevice(adb, serial);
    const health = await fetchJson(`${serverUrl}/health`);
    const audioRuntime = await fetchJson(`${serverUrl}/api/audio-runtime`);
    writeFileSync(join(runDir, 'health.json'), `${JSON.stringify(health, null, 2)}\n`);
    writeFileSync(join(runDir, 'audio-runtime.json'), `${JSON.stringify(audioRuntime, null, 2)}\n`);
    if ((suite === 'stable' || suite === 'full') && audioRuntime.mode !== 'hybrid') {
      throw new Error(
        `稳定套件要求 hybrid 音频模式，当前为 ${audioRuntime.mode}；编排器不会修改租户设置。`,
      );
    }

    logcat = startLoggedProcess(
      adb,
      [
        '-s',
        serial,
        'logcat',
        '-v',
        'threadtime',
        'ReactNativeJS:V',
        'ReactNative:V',
        'Expo:V',
        'AndroidRuntime:E',
        '*:S',
      ],
      join(runDir, 'logcat.txt'),
    );
    const flowEnvironment = maestroEnvironment(context);
    for (const flow of flows) {
      const flowName = basename(flow, '.yaml');
      const flowDir = join(runDir, 'flows', flowName);
      mkdirSync(flowDir, { recursive: true });
      const reportPath = join(flowDir, 'junit.xml');
      const args = ['--device', serial, 'test', join(maestroRoot, flow)];
      for (const [key, value] of Object.entries(flowEnvironment))
        args.push('-e', `${key}=${value}`);
      args.push(
        '--format',
        'junit',
        '--output',
        reportPath,
        '--test-output-dir',
        flowDir,
        '--debug-output',
        flowDir,
        '--flatten-debug-output',
      );
      const startedAt = Date.now();
      const result = runCommand(maestro, args, { allowFailure: true });
      writeFileSync(
        join(flowDir, 'maestro-console.log'),
        `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
      );
      summary.flows.push({
        name: flow,
        status: result.status === 0 ? 'passed' : 'failed',
        durationMs: Date.now() - startedAt,
        report: relative(runDir, reportPath),
        artifacts: relative(runDir, flowDir).replaceAll('\\', '/'),
      });
      writeFileSync(join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
      if (result.status !== 0) throw new Error(`Maestro Flow 失败：${flow}`);
    }

    summary.status = 'passed';
    summary.completedAt = new Date().toISOString();
    writeFileSync(join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    writeFileSync(join(runDir, 'report-detailed.html'), renderHtmlReport(summary));
    await cleanupRunResources(context, runDir);
    console.log(`E2E 通过：${runId}`);
    console.log(`报告：${join(runDir, 'report-detailed.html')}`);
  } catch (error) {
    summary.status = 'failed';
    summary.completedAt = new Date().toISOString();
    summary.error = error instanceof Error ? error.message : String(error);
    writeFileSync(join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    writeFileSync(join(runDir, 'report-detailed.html'), renderHtmlReport(summary));
    const gitStatus = runCommand('git', ['status', '--short'], { allowFailure: true });
    writeFileSync(join(runDir, 'git-status.txt'), gitStatus.stdout ?? '');
    // 先释放 3201/8081 及其子进程，再运行可能耗时的只读诊断，避免失败后端口长期占用。
    cleanupStartedProcesses();
    console.error(`E2E 失败，现场已保留：${runDir}`);
    try {
      runTriage(runId, environment.commands.codex);
    } catch (triageError) {
      console.error(triageError instanceof Error ? triageError.message : String(triageError));
    }
    throw error;
  } finally {
    cleanupStartedProcesses();
    if (activeProcessCleanup === cleanupStartedProcesses) activeProcessCleanup = null;
  }
}

async function main() {
  mkdirSync(artifactsRoot, { recursive: true });
  const { options, positionals } = parseArgs(process.argv.slice(2));
  const action = positionals[0];
  if (action === 'preflight') {
    const environment = await inspectEnvironment();
    printChecks(environment.checks);
    assertRequiredChecks(environment.checks);
    return;
  }
  if (['stable', 'real', 'full'].includes(action)) {
    await runSuite(action, options.from);
    return;
  }
  if (action === 'triage') {
    runTriage(assertValidRunId(options.run));
    return;
  }
  if (action === 'repair') {
    runRepair(assertValidRunId(options.run), options.confirm);
    return;
  }
  throw new Error(
    '用法：android-e2e.mjs <preflight|stable|real|full|triage|repair> [--from <flow-name>]',
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
