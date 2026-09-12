/**
 * 独立补录入口的选择、参数与执行边界回归。
 *
 * 使用注入执行器验证成功、首条失败和人工取消；不连接手机、不调用 AI 或启动服务。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  RETAKE_FLOWS,
  executeRetakeSession,
  requiredRetakeParameters,
  retakeMaestroArgs,
  retakePowerShellCommand,
  selectRetakeFlows,
  validateRetakeParameters,
} from './showcase-retake.mjs';

const repoRoot = resolve(import.meta.dirname, '../..');
const sample = JSON.parse(
  readFileSync(resolve(repoRoot, '.maestro/fixtures/showcase-retake.params.example.json'), 'utf8'),
);
const configured = Object.fromEntries(
  requiredRetakeParameters(RETAKE_FLOWS).map((key) => [key, `真实_${key}`]),
);

test('pnpm entry isolates retakes from service bootstrap and resource cleanup', () => {
  const manifest = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
  assert.equal(
    manifest.scripts['e2e:android:showcase-retake'],
    'node scripts/e2e/showcase-retake.mjs',
  );
  const source = readFileSync(resolve(import.meta.dirname, 'showcase-retake.mjs'), 'utf8');
  assert.doesNotMatch(
    source,
    /android-e2e\.mjs|prepareServices|prepareDevice|cleanupRunResources|apps.*api.*\.env|fetch\(/u,
  );
});

test('retake selects all, an exact single flow or an exact resume suffix', () => {
  assert.deepEqual(selectRetakeFlows(), RETAKE_FLOWS);
  assert.deepEqual(selectRetakeFlows({ flow: '03-knowledge-answer-citation.yaml' }), [
    RETAKE_FLOWS[2],
  ]);
  assert.deepEqual(
    selectRetakeFlows({ from: '02-business-insights-evidence' }),
    RETAKE_FLOWS.slice(1),
  );
  assert.throws(() => selectRetakeFlows({ flow: '03', from: '02' }), /不能同时/u);
  assert.throws(() => selectRetakeFlows({ flow: 'stable/01-bootstrap-navigation' }), /未知/u);
});

test('parameter contract rejects placeholders, missing values, wrong types and secrets without printing values', () => {
  assert.deepEqual(Object.keys(sample).sort(), requiredRetakeParameters(RETAKE_FLOWS));
  assert.throws(() => validateRetakeParameters(RETAKE_FLOWS, sample), /请填写/u);
  assert.throws(() => validateRetakeParameters(RETAKE_FLOWS, []), /JSON 对象/u);
  assert.throws(
    () => validateRetakeParameters(RETAKE_FLOWS, { CREDENTIAL: 'private-secret' }),
    (error) => !error.message.includes('private-secret'),
  );
  assert.throws(
    () => validateRetakeParameters(RETAKE_FLOWS, { ...configured, RETAKE_ROLE_A_TEXT: 3 }),
    /RETAKE_ROLE_A_TEXT/u,
  );
  assert.throws(
    () =>
      validateRetakeParameters(RETAKE_FLOWS, {
        ...configured,
        RETAKE_ROLE_A_TEXT: '\nprivate-secret',
      }),
    (error) => !error.message.includes('private-secret'),
  );
  const parameters = validateRetakeParameters([RETAKE_FLOWS[2]], configured, {
    RETAKE_ANSWER_TEXT: '环境变量覆盖',
  });
  assert.equal(parameters.RETAKE_ANSWER_TEXT, '环境变量覆盖');
  assert.ok(!('RETAKE_GROUP_NAME' in parameters));
});

test('Maestro only receives the selected flow parameters and dedicated artifact paths', () => {
  const output = resolve(repoRoot, '.artifacts/maestro/test-retake/03');
  const args = retakeMaestroArgs(RETAKE_FLOWS[2], configured, 'private-device', output);
  assert.ok(args.includes('--test-output-dir'));
  assert.ok(args.includes(resolve(output, 'junit.xml')));
  assert.ok(args.includes(`RETAKE_ANSWER_TEXT=${configured.RETAKE_ANSWER_TEXT}`));
  assert.ok(!args.some((arg) => arg.startsWith('RETAKE_GROUP_NAME=')));
  assert.ok(!args.includes('launchApp'));
  const script = retakePowerShellCommand('maestro', ['测试 $value $(malicious); `x`', "O'Reilly"]);
  assert.match(script, /'测试 \$value \$\(malicious\); `x`'/u);
  assert.match(script, /'O''Reilly'/u);
});

test('successful batch prompts before every flow and persists complete isolated statuses', async () => {
  const events = [];
  const snapshots = [];
  const summary = await executeRetakeSession({
    flows: RETAKE_FLOWS,
    confirm: async (flow) => {
      events.push(`confirm:${flow}`);
      return true;
    },
    execute: async (flow) => {
      events.push(`execute:${flow}`);
      return 0;
    },
    persist: (state) => snapshots.push(structuredClone(state)),
  });
  assert.deepEqual(
    events,
    RETAKE_FLOWS.flatMap((flow) => [`confirm:${flow}`, `execute:${flow}`]),
  );
  assert.equal(summary.status, 'passed');
  assert.ok(summary.flows.every((flow) => flow.status === 'passed'));
  assert.equal(summary.cleanupStatus, 'not-applicable');
  assert.ok(snapshots.some((state) => state.flows[2].status === 'awaiting-preparation'));
  assert.doesNotMatch(JSON.stringify(summary), /private-device|RETAKE_ANSWER_TEXT/u);
});

test('first failing flow persists failure and never runs later footage', async () => {
  const executed = [];
  let snapshot;
  await assert.rejects(
    executeRetakeSession({
      flows: RETAKE_FLOWS,
      confirm: async () => true,
      execute: async (flow) => {
        executed.push(flow);
        return flow === RETAKE_FLOWS[1] ? 1 : 0;
      },
      persist: (state) => {
        snapshot = structuredClone(state);
      },
    }),
    /02-business-insights-evidence/u,
  );
  assert.deepEqual(executed, RETAKE_FLOWS.slice(0, 2));
  assert.equal(snapshot.status, 'failed');
  assert.equal(snapshot.failureStage, 'flow');
  assert.deepEqual(
    snapshot.flows.map((flow) => flow.status),
    ['passed', 'failed', 'not-run', 'not-run'],
  );
});

test('manual cancellation and preparation failure never start recording', async () => {
  const summary = await executeRetakeSession({
    flows: RETAKE_FLOWS,
    confirm: async () => false,
    execute: () => {
      assert.fail('must not execute');
    },
    persist: () => {},
  });
  assert.equal(summary.status, 'canceled');
  assert.deepEqual(
    summary.flows.map((flow) => flow.status),
    ['canceled', 'not-run', 'not-run', 'not-run'],
  );
  let snapshot;
  await assert.rejects(
    executeRetakeSession({
      flows: RETAKE_FLOWS,
      confirm: async () => {
        throw new Error('private-secret');
      },
      execute: () => {
        assert.fail('must not execute');
      },
      persist: (state) => {
        snapshot = structuredClone(state);
      },
    }),
    (error) => !error.message.includes('private-secret'),
  );
  assert.equal(snapshot.failureStage, 'preparation');
});
