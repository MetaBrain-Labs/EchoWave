import { randomBytes } from 'node:crypto';

const RUN_ID_PATTERN = /^E2E_\d{8}T\d{6}Z_[A-F0-9]{6}$/;

export function parseArgs(argv) {
  const args = argv.filter((value) => value !== '--');
  const options = {};
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }

    const [key, inlineValue] = value.slice(2).split('=', 2);
    if (inlineValue !== undefined) {
      options[key] = inlineValue;
      continue;
    }

    const next = args[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }

  return { options, positionals };
}

export function parseEnvPort(contents, variable = 'PORT') {
  const pattern = new RegExp(`^\\s*${variable}\\s*=\\s*["']?(\\d+)["']?\\s*(?:#.*)?$`, 'mu');
  const match = contents.match(pattern);
  const port = Number(match?.[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${variable} 必须是 1-65535 范围内的端口。`);
  }
  return port;
}

export function createRunId(now = new Date(), random = randomBytes(3).toString('hex')) {
  // 运行 ID 只使用整秒，避免毫秒小数破坏 ASCII 格式和后续精确确认门禁。
  const timestamp = `${now.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
  return `E2E_${timestamp}_${random.toUpperCase()}`;
}

export function isValidRunId(value) {
  return typeof value === 'string' && RUN_ID_PATTERN.test(value);
}

export function assertValidRunId(value) {
  if (!isValidRunId(value)) {
    throw new Error(`无效运行 ID：${String(value)}。必须是 E2E_YYYYMMDDTHHMMSSZ_XXXXXX。`);
  }
  return value;
}

export function parseAdbDevices(output) {
  return output
    .split(/\r?\n/u)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state = 'unknown'] = line.split(/\s+/u);
      return { serial, state };
    });
}

export function selectFlowsFrom(flows, fromFlow) {
  if (!fromFlow) return [...flows];
  const requested = String(fromFlow)
    .replaceAll('\\', '/')
    .replace(/\.yaml$/u, '');
  const index = flows.findIndex((flow) => {
    const normalized = flow.replaceAll('\\', '/').replace(/\.yaml$/u, '');
    return normalized === requested || normalized.endsWith(`/${requested}`);
  });
  if (index < 0) {
    throw new Error(
      `未知起始 Flow：${fromFlow}。可选值：${flows
        .map((flow) =>
          flow
            .replaceAll('\\', '/')
            .split('/')
            .at(-1)
            ?.replace(/\.yaml$/u, ''),
        )
        .join('、')}`,
    );
  }
  return flows.slice(index);
}

/**
 * 检查设备实际使用的 Metro 状态端点，不尝试其他地址族或主机名。
 */
export async function isMetroStatusHealthy(statusUrl, fetchImplementation = globalThis.fetch) {
  try {
    const response = await fetchImplementation(statusUrl, {
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok && (await response.text()).includes('packager-status:running');
  } catch {
    return false;
  }
}

export function collectExactCleanupTargets(resources, context) {
  const expected = {
    groups: new Set(context.createdResources?.groupNames ?? []),
    dataSources: new Set(context.createdResources?.dataSourceNames ?? []),
    knowledgeBases: new Set(context.createdResources?.knowledgeBaseNames ?? []),
  };

  return {
    groups: (resources.groups ?? []).filter((item) => expected.groups.has(item.name)),
    dataSources: (resources.dataSources ?? []).filter((item) =>
      expected.dataSources.has(item.name),
    ),
    knowledgeBases: (resources.knowledgeBases ?? []).filter((item) =>
      expected.knowledgeBases.has(item.name),
    ),
  };
}

/**
 * 将请求地址压缩为可诊断但不暴露查询参数和凭据的形式。
 */
export function redactRequestUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}

/**
 * 提取 Error cause 链，避免网络异常最终只剩下笼统的 fetch failed。
 */
export function errorCauseChain(error) {
  const messages = [];
  const visited = new Set();
  let current = error;
  while (current && !visited.has(current)) {
    visited.add(current);
    const message = current instanceof Error ? current.message : String(current);
    if (message && !messages.includes(message)) messages.push(message);
    current = current instanceof Error ? current.cause : undefined;
  }
  return messages;
}

/**
 * 执行可安全重试的清理请求，并把每次尝试写入调用方持有的操作记录。
 */
export async function runRetriableCleanupRequest({
  request,
  stage,
  url,
  options = {},
  maxAttempts = 2,
  onUpdate = () => undefined,
}) {
  const method = String(options.method ?? 'GET').toUpperCase();
  const attemptLimit = ['GET', 'DELETE'].includes(method) ? maxAttempts : 1;
  const operation = {
    stage,
    method,
    url: redactRequestUrl(url),
    status: 'running',
    attempts: [],
  };
  onUpdate(operation);

  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    try {
      const body = await request(url, options);
      operation.attempts.push({ attempt, status: 'passed' });
      operation.status = 'passed';
      onUpdate(operation);
      return body;
    } catch (error) {
      const causes = errorCauseChain(error);
      operation.attempts.push({ attempt, status: 'failed', causes });
      onUpdate(operation);
      if (error?.retryable === false || attempt === attemptLimit) {
        operation.status = 'failed';
        onUpdate(operation);
        const failure = new Error(
          `套后清理失败 [${stage}] ${method} ${operation.url}，尝试 ${attempt} 次：${causes.join(' -> ')}`,
          { cause: error },
        );
        failure.cleanupOperation = operation;
        throw failure;
      }
    }
  }

  throw new Error(`套后清理请求未执行：${stage}`);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderHtmlReport(summary) {
  const rows = summary.flows
    .map(
      (flow) =>
        `<tr><td>${escapeHtml(flow.name)}</td><td>${escapeHtml(flow.status)}</td><td>${escapeHtml(flow.durationMs ?? '')}</td><td><a href="${escapeHtml(flow.artifacts ?? '')}">${escapeHtml(flow.report ?? '')}</a></td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(summary.runId)}</title>
<style>body{font:14px system-ui;margin:32px;color:#172033}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd3df;padding:8px;text-align:left}.passed{color:#137333}.failed{color:#b3261e}</style></head>
<body><h1>EchoWave Android E2E Detailed Report</h1><p>运行：${escapeHtml(summary.runId)}</p><p>套件：${escapeHtml(summary.suite)}</p><p class="${escapeHtml(summary.status)}">结果：${escapeHtml(summary.status)}</p><p>Flow：${escapeHtml(summary.flowStatus ?? '')}；套后清理：${escapeHtml(summary.cleanupStatus ?? '')}；失败阶段：${escapeHtml(summary.failureStage ?? '无')}</p><p>每个 JUnit 链接指向同目录的截图、录像、commands JSON 与 Maestro 日志。</p>
<table><thead><tr><th>Flow</th><th>状态</th><th>耗时 (ms)</th><th>JUnit</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

export function renderTriageMarkdown(triage) {
  const list = (values) =>
    (values?.length ? values : ['无']).map((value) => `- ${String(value)}`).join('\n');

  return `# EchoWave E2E 失败诊断

- 分类：${triage.classification}
- 置信度：${triage.confidence}
- 需要用户操作：${triage.needsUserAction ? '是' : '否'}

## 根因

${triage.likelyRootCause}

## 失败 Flow

${list(triage.failingFlows)}

## 失败步骤

${list(triage.failedSteps)}

## 关键证据

${list(triage.evidence)}

## 复现条件

${list(triage.reproduction)}

## 建议修改位置

${list(triage.proposedFiles)}

## 最小修复方案

${list(triage.proposedChanges)}

## 重测命令

${list(triage.verificationCommands)}

## 用户操作

${triage.userAction || '无'}
`;
}
