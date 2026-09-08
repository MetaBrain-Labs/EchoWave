import { selectFlowsFrom } from './lib.mjs';

export const STABLE_FLOWS = [
  'flows/stable/01-bootstrap-navigation.yaml',
  'flows/stable/02-resource-crud.yaml',
  'flows/stable/03-seeded-analysis.yaml',
  'flows/stable/04-lifecycle-errors.yaml',
  'flows/stable/05-onboarding-validation.yaml',
  'flows/stable/06-settings-archive.yaml',
];

export const REAL_FLOWS = [
  'flows/real/01-audio-analysis.yaml',
  'flows/real/02-knowledge-rag.yaml',
  'flows/real/03-push-capability.yaml',
];

export const SHOWCASE_FLOWS = [
  'flows/showcase/01-onboarding-navigation.yaml',
  'flows/showcase/02-workspace-analysis.yaml',
  'flows/showcase/03-knowledge-rag.yaml',
  'flows/showcase/04-settings-reliability.yaml',
  'flows/showcase/05-search-lifecycle.yaml',
];

/**
 * 返回指定 Android E2E 套件的有序 Flow，并支持从精确名称恢复执行。
 */
export function suiteFlows(suite, fromFlow) {
  const suites = {
    stable: STABLE_FLOWS,
    real: REAL_FLOWS,
    showcase: SHOWCASE_FLOWS,
    full: [...STABLE_FLOWS, ...REAL_FLOWS],
  };
  const flows = suites[suite];
  if (!flows) throw new Error(`未知 E2E 套件：${suite}`);
  return selectFlowsFrom(flows, fromFlow);
}

/**
 * 生成公开演示可读、但不会暴露运行 ID 的资源名称。
 */
export function showcaseNames(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const date = `${month}${day}`;
  return {
    audioTitle: 'EchoWave Product Interview',
    deviceAudioName: 'EchoWave Product Interview.mp3',
    deviceKnowledgeName: 'EchoWave-Product-Brief.md',
    groupName: `产品访谈 · ${date}`,
    dataSourceName: `用户研究录音 · ${date}`,
    knowledgeBaseName: `产品研究知识库 · ${date}`,
  };
}
