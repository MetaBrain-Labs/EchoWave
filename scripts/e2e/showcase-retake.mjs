/**
 * 宣传片补录专用入口。
 *
 * 只连接已有 App 会话并执行独立 Maestro Flow，不准备服务、修改运行模式或清理业务资源。
 * 每条录制前由用户确认现场页面；参数和设备标识不写入运行汇总。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';

import { createRunId, parseAdbDevices, parseArgs, selectFlowsFrom } from './lib.mjs';

const repoRoot = resolve(import.meta.dirname, '../..');
export const RETAKE_FLOWS = [
  'flows/showcase-retake/01-transcript-speaker-emotion.yaml',
  'flows/showcase-retake/02-business-insights-evidence.yaml',
  'flows/showcase-retake/03-knowledge-answer-citation.yaml',
  'flows/showcase-retake/04-confirmation-task-status.yaml',
];

/** 只允许本补录集合，单条执行与断点恢复不能混用。 */
export function selectRetakeFlows({ flow, from } = {}) {
  if (flow && from) throw new Error('--flow 与 --from 不能同时使用。');
  const selected = selectFlowsFrom(RETAKE_FLOWS, flow ?? from);
  return flow ? selected.slice(0, 1) : selected;
}

/** 从 Flow 与只读公共入口推导参数，避免手工维护第二份参数契约。 */
export function requiredRetakeParameters(flows) {
  const sources = flows.map((flow) => readFileSync(resolve(repoRoot, '.maestro', flow), 'utf8'));
  if (sources.some((source) => source.includes('subflows/open-retake-audio.yaml'))) {
    sources.push(
      readFileSync(resolve(repoRoot, '.maestro/subflows/open-retake-audio.yaml'), 'utf8'),
    );
  }
  return [...new Set(sources.join('\n').match(/RETAKE_[A-Z_]+/gu))].sort();
}

/** 校验显式本地配置；环境变量覆盖文件，只转发当前 Flow 实际需要的参数。 */
export function validateRetakeParameters(flows, configured = {}, environment = {}) {
  if (!configured || Array.isArray(configured) || typeof configured !== 'object') {
    throw new Error('补录参数文件必须是 JSON 对象。');
  }
  const known = new Set(requiredRetakeParameters(RETAKE_FLOWS));
  for (const key of Object.keys(configured)) {
    if (!known.has(key)) throw new Error(`未知补录参数：${key}`);
  }
  const parameters = {};
  const invalid = [];
  for (const key of requiredRetakeParameters(flows)) {
    const value = environment[key] ?? configured[key];
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.includes('__SET_') ||
      /[\r\n\0]/u.test(value)
    ) {
      invalid.push(key);
    } else {
      parameters[key] = value;
    }
  }
  if (invalid.length) throw new Error(`请填写补录参数（仅列名称）：${invalid.join(', ')}`);
  return parameters;
}

/** 参数逐项转发给 Maestro，独立生成录屏、截图、日志与 JUnit。 */
export function retakeMaestroArgs(flow, parameters, serial, flowDir) {
  const args = ['--device', serial, 'test', resolve(repoRoot, '.maestro', flow)];
  for (const key of requiredRetakeParameters([flow])) args.push('-e', `${key}=${parameters[key]}`);
  args.push(
    '--format',
    'junit',
    '--output',
    resolve(flowDir, 'junit.xml'),
    '--test-output-dir',
    flowDir,
    '--debug-output',
    flowDir,
    '--flatten-debug-output',
  );
  return args;
}

/** Windows 使用 PowerShell 单引号逐参数引用，不让正文成为可执行命令。 */
export function retakePowerShellCommand(command, args) {
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  return `& ${quote(command)} ${args.map(quote).join(' ')}; exit $LASTEXITCODE`;
}

/** 可注入的补录状态机：取消或首条失败后停止，保留已完成与未执行状态。 */
export async function executeRetakeSession({ flows, confirm, execute, persist }) {
  const summary = {
    suite: 'showcase-retake',
    status: 'running',
    cleanupStatus: 'not-applicable',
    startedAt: new Date().toISOString(),
    flows: flows.map((flow) => ({ name: flow, status: 'not-run' })),
  };
  persist(summary);
  for (const entry of summary.flows) {
    try {
      entry.status = 'awaiting-preparation';
      persist(summary);
      if (!(await confirm(entry.name))) {
        entry.status = 'canceled';
        summary.status = 'canceled';
        summary.completedAt = new Date().toISOString();
        persist(summary);
        return summary;
      }
      entry.status = 'running';
      persist(summary);
      const startedAt = Date.now();
      const exitCode = await execute(entry.name);
      entry.durationMs = Date.now() - startedAt;
      entry.exitCode = exitCode;
      if (exitCode !== 0) throw new Error('flow failed');
      entry.status = 'passed';
      persist(summary);
    } catch {
      summary.failureStage = entry.status === 'awaiting-preparation' ? 'preparation' : 'flow';
      entry.status = 'failed';
      summary.status = 'failed';
      summary.completedAt = new Date().toISOString();
      persist(summary);
      throw new Error(`补录停止：${basename(entry.name)}。请检查该条的日志与截图。`);
    }
  }
  summary.status = 'passed';
  summary.completedAt = new Date().toISOString();
  persist(summary);
  return summary;
}

function runTool(command, args, capture = false) {
  const result =
    process.platform === 'win32'
      ? spawnSync(
          'powershell.exe',
          [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            retakePowerShellCommand(command, args),
          ],
          {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: capture ? 'pipe' : 'inherit',
            windowsHide: true,
          },
        )
      : spawnSync(command, args, {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: capture ? 'pipe' : 'inherit',
        });
  if (result.error) throw new Error(`无法执行 ${command}，请检查工具安装与 PATH。`);
  return result;
}

/** 不读取 API 环境文件、不启动服务，仅检查工具与已授权设备后录制。 */
async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      'pnpm e2e:android:showcase-retake [--params <JSON>] [--flow <精确文件名> | --from <精确文件名>] [--device <设备>] [--non-interactive]',
    );
    return;
  }
  const allowed = new Set(['params', 'flow', 'from', 'device', 'non-interactive']);
  if (positionals.length || Object.keys(options).some((key) => !allowed.has(key)))
    throw new Error('未知参数，请使用 --help。');
  for (const key of ['params', 'flow', 'from', 'device']) {
    if (options[key] !== undefined && typeof options[key] !== 'string')
      throw new Error(`--${key} 需要值。`);
  }
  if (options['non-interactive'] !== undefined && options['non-interactive'] !== true)
    throw new Error('--non-interactive 是无值开关。');
  const flows = selectRetakeFlows(options);
  if (options['non-interactive'] && !options.flow)
    throw new Error('--non-interactive 必须搭配 --flow；完整补录需要逐条准备页面。');
  if (!options['non-interactive'] && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new Error('请在交互式终端运行；非交互模式只能显式选择单条 --flow。');
  }
  const paramsPath = resolve(repoRoot, options.params ?? '.artifacts/showcase-retake.params.json');
  let configured = {};
  if (existsSync(paramsPath)) {
    try {
      configured = JSON.parse(readFileSync(paramsPath, 'utf8'));
    } catch {
      throw new Error('补录参数文件不是可读取的有效 JSON；参数值不会打印。');
    }
  } else if (options.params) throw new Error('指定的补录参数文件不存在。');
  const parameters = validateRetakeParameters(flows, configured, process.env);
  if (runTool('maestro', ['--version'], true).status !== 0)
    throw new Error('Maestro 检查失败，请修复本机工具环境后重试。');
  const devicesResult = runTool('adb', ['devices'], true);
  if (devicesResult.status !== 0) throw new Error('ADB 检查失败。');
  const devices = parseAdbDevices(devicesResult.stdout ?? '').filter(
    (device) => device.state === 'device',
  );
  const device = options.device
    ? devices.find((item) => item.serial === options.device)
    : devices.length === 1
      ? devices[0]
      : null;
  if (!device) throw new Error('需要唯一已授权 Android 设备；多设备时传 --device。');
  const runId = createRunId().replace(/^E2E_/u, 'RETAKE_');
  const runDir = resolve(repoRoot, '.artifacts/maestro', runId);
  mkdirSync(dirname(runDir), { recursive: true });
  mkdirSync(runDir, { recursive: false });
  console.log(`补录素材目录：.artifacts/maestro/${runId}`);
  const readline = options['non-interactive']
    ? null
    : createInterface({ input: process.stdin, output: process.stdout });
  try {
    const summary = await executeRetakeSession({
      flows,
      confirm: async (flow) => {
        if (!readline) return true;
        const preparation = flow.includes('03-knowledge')
          ? '手动打开正确知识库中当前会话已完成且带引用的问答；不要重启 App。'
          : '手动回到分组主页面，列表回到顶部，确保已有结果且无敏感覆盖物。';
        const answer = await readline.question(
          `\n${basename(flow)}\n${preparation}\n准备好输入 y 开始录制，其他输入取消本次运行：`,
        );
        return answer.trim().toLowerCase() === 'y';
      },
      execute: (flow) => {
        const flowDir = resolve(runDir, 'flows', basename(flow, '.yaml'));
        mkdirSync(flowDir, { recursive: true });
        return (
          runTool('maestro', retakeMaestroArgs(flow, parameters, device.serial, flowDir)).status ??
          1
        );
      },
      persist: (summary) =>
        writeFileSync(
          resolve(runDir, 'summary.json'),
          `${JSON.stringify({ runId, ...summary }, null, 2)}\n`,
        ),
    });
    if (summary.status !== 'passed') process.exitCode = 1;
    console.log(`补录状态：${summary.status}；只保留素材，不执行资源清理或视频渲染。`);
  } finally {
    readline?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
