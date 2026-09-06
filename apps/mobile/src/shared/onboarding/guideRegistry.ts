/**
 * EchoWave 引导注册表与定位几何。
 *
 * 集中定义六项独立引导、目标键和纯几何计算，供 Provider、引导中心和测试共同使用。
 *
 * Responsibilities:
 * - 维护引导元数据及步骤顺序。
 * - 将屏幕坐标转换为安全的 React Native left/top 布局。
 * - 计算贴近目标且不会被窗口截断的说明卡与箭头位置。
 */
export const GUIDE_IDS = [
  'basic',
  'knowledge',
  'data_sources',
  'ai_configuration',
  'runtime_mode',
  'analysis',
] as const;

export type GuideId = (typeof GUIDE_IDS)[number];
export type GuideStatus = 'not_started' | 'completed' | 'skipped';
export type StarterTourTargetKey =
  | 'group-title'
  | 'group-template-example'
  | 'group-menu'
  | 'group-settings'
  | 'create-source'
  | 'create-group'
  | 'create-audio'
  | 'knowledge-header'
  | 'knowledge-create'
  | 'knowledge-form'
  | 'data-sources-header'
  | 'data-sources-create'
  | 'ai-security'
  | 'ai-configuration'
  | 'runtime-notice'
  | 'runtime-modes'
  | 'runtime-save'
  | 'example-overview'
  | 'example-transcript'
  | 'example-report';

export type GuideRoute =
  | 'group'
  | 'create'
  | 'knowledge'
  | 'data_sources'
  | 'ai_configuration'
  | 'runtime_mode'
  | 'analysis';

export type GuideStep = {
  body: string;
  route: GuideRoute;
  target?: StarterTourTargetKey;
  title: string;
};
export type GuideDefinition = {
  description: string;
  id: GuideId;
  title: string;
  steps: readonly GuideStep[];
};

export const GUIDE_REGISTRY: Record<GuideId, GuideDefinition> = {
  basic: {
    id: 'basic',
    title: '基础引导',
    description: '认识模板分组并完成首次录音分析准备。',
    steps: [
      {
        route: 'group',
        title: '欢迎使用 EchoWave',
        body: '我们已准备好销售通话复盘和个人表达教练两个可直接使用的分组模板。',
      },
      {
        route: 'group',
        target: 'group-title',
        title: '从模板分组开始',
        body: '模板预置了适合对应场景的分析重点，你仍可按自己的目标调整。',
      },
      {
        route: 'group',
        target: 'group-template-example',
        title: '先看一份模板示例',
        body: '只读示例展示转写、证据和建议，不会计入你的真实音频与分析数量。',
      },
      {
        route: 'group',
        target: 'group-menu',
        title: '切换或归档模板',
        body: '打开分组菜单可以切换模板；不需要的模板可从分组设置中归档。',
      },
      {
        route: 'group',
        target: 'group-settings',
        title: '按目标调整',
        body: '这里可修改分析时机、内容侧重、报告语气和自定义标签。',
      },
      {
        route: 'create',
        target: 'create-source',
        title: '选择数据源',
        body: '选择录音所属的数据源，起步模板默认关联“快速录音上传”。',
      },
      {
        route: 'create',
        target: 'create-group',
        title: '选择模板分组',
        body: '选择销售通话复盘或个人表达教练，决定本次分析方向。',
      },
      {
        route: 'create',
        target: 'create-audio',
        title: '上传第一段录音',
        body: '选择销售通话、自我介绍或演讲音频，然后启动全流程分析。',
      },
    ],
  },
  knowledge: {
    id: 'knowledge',
    title: '知识库引导',
    description: '了解知识库入口与创建流程，不实际创建内容。',
    steps: [
      {
        route: 'knowledge',
        target: 'knowledge-header',
        title: '知识库',
        body: '知识库用于为分析和问答提供经过维护的业务材料。',
      },
      {
        route: 'knowledge',
        target: 'knowledge-create',
        title: '创建入口',
        body: '从这里可以打开创建表单。',
      },
      {
        route: 'knowledge',
        target: 'knowledge-form',
        title: '了解创建内容',
        body: '表单会临时展开供你了解字段；引导不会提交或写入任何知识库。',
      },
    ],
  },
  data_sources: {
    id: 'data_sources',
    title: '数据源引导',
    description: '认识音频数据源与连接入口。',
    steps: [
      {
        route: 'data_sources',
        target: 'data-sources-header',
        title: '数据源',
        body: '数据源组织音频入口、处理状态以及关联分组。',
      },
      {
        route: 'data_sources',
        target: 'data-sources-create',
        title: '新建数据源',
        body: '从这里配置新的来源；引导只做说明，不创建或保存。',
      },
    ],
  },
  ai_configuration: {
    id: 'ai_configuration',
    title: 'AI 配置引导',
    description: '了解安全校验、供应商和能力绑定。',
    steps: [
      {
        route: 'ai_configuration',
        target: 'ai-security',
        title: '先完成安全校验',
        body: 'AI 密钥属于敏感配置，需要管理员口令和受信任连接。',
      },
      {
        route: 'ai_configuration',
        target: 'ai-configuration',
        title: '供应商与能力绑定',
        body: '校验后可以查看供应商连接和模型能力绑定；本引导不会保存任何配置。',
      },
    ],
  },
  runtime_mode: {
    id: 'runtime_mode',
    title: '运行模式引导',
    description: '理解音频存储、处理与保留策略。',
    steps: [
      {
        route: 'runtime_mode',
        target: 'runtime-notice',
        title: '模式影响范围',
        body: '运行模式只影响新上传音频，已有任务保持原来的冻结配置。',
      },
      {
        route: 'runtime_mode',
        target: 'runtime-modes',
        title: '选择运行模式',
        body: '比较混合、对象存储与轻量本地模式的处理边界。',
      },
      {
        route: 'runtime_mode',
        target: 'runtime-save',
        title: '保存需要管理员确认',
        body: '只有主动点击保存才会修改配置；引导本身不会写入。',
      },
    ],
  },
  analysis: {
    id: 'analysis',
    title: '查看分析引导',
    description: '用销售模板只读示例认识分析报告。',
    steps: [
      {
        route: 'analysis',
        target: 'example-overview',
        title: '只读示例概览',
        body: '这是稳定的销售通话示例，不依赖真实分析记录，也不包含原始音频。',
      },
      {
        route: 'analysis',
        target: 'example-transcript',
        title: '转写与角色',
        body: '每段包含时间范围、角色和情绪，报告证据会引用这些片段。',
      },
      {
        route: 'analysis',
        target: 'example-report',
        title: '结论与改进建议',
        body: '报告同时呈现有效做法、待确认风险和可直接执行的下一步。',
      },
    ],
  },
};

export type WindowRect = { height: number; width: number; x: number; y: number };
export type LayoutRect = { height: number; left: number; top: number; width: number };

/** 将测量坐标扩展并裁剪到可视窗口内。 */
export function clampSpotlight(
  rect: WindowRect,
  windowWidth: number,
  windowHeight: number,
  gap = 7,
): LayoutRect | null {
  const left = Math.max(0, Math.min(windowWidth, rect.x - gap));
  const top = Math.max(0, Math.min(windowHeight, rect.y - gap));
  const right = Math.max(left, Math.min(windowWidth, rect.x + rect.width + gap));
  const bottom = Math.max(top, Math.min(windowHeight, rect.y + rect.height + gap));
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/** 计算说明卡、朝向和相对目标中心的箭头位置。 */
export function placeTourCard(
  spotlight: LayoutRect | null,
  windowWidth: number,
  windowHeight: number,
  cardWidth: number,
  cardHeight: number,
  margin = 16,
) {
  if (!spotlight) {
    return {
      arrowLeft: 0,
      below: true,
      left: (windowWidth - cardWidth) / 2,
      top: Math.max(margin, (windowHeight - cardHeight) / 2),
    };
  }
  const belowSpace = windowHeight - (spotlight.top + spotlight.height) - margin;
  const below = belowSpace >= cardHeight || spotlight.top < cardHeight + margin * 2;
  const top = below
    ? Math.min(windowHeight - cardHeight - margin, spotlight.top + spotlight.height + margin)
    : Math.max(margin, spotlight.top - cardHeight - margin);
  const left = Math.min(
    windowWidth - cardWidth - margin,
    Math.max(margin, spotlight.left + spotlight.width / 2 - cardWidth / 2),
  );
  const arrowLeft = Math.min(
    cardWidth - 34,
    Math.max(14, spotlight.left + spotlight.width / 2 - left - 10),
  );
  return { arrowLeft, below, left, top };
}
