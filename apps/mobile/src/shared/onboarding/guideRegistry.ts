/**
 * EchoWave 引导注册表与定位几何。
 *
 * 集中定义九项独立引导、目标键和纯几何计算，供 Provider、引导中心和测试共同使用。
 *
 * Responsibilities:
 * - 维护引导元数据及步骤顺序。
 * - 将屏幕坐标转换为安全的 React Native left/top 布局。
 * - 计算贴近目标且不会被窗口截断的说明卡与箭头位置。
 */
import type { TranslationKey } from '@/shared/i18n/translations';

export const GUIDE_IDS = [
  'basic',
  'knowledge',
  'knowledge_query',
  'data_sources',
  'group_settings',
  'knowledge_collection',
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
  | 'group-tabs'
  | 'group-settings'
  | 'create-source'
  | 'create-group'
  | 'create-audio'
  | 'knowledge-header'
  | 'knowledge-create'
  | 'knowledge-form'
  | 'knowledge-overview'
  | 'knowledge-files'
  | 'knowledge-upload'
  | 'knowledge-document-status'
  | 'document-block-list'
  | 'block-content'
  | 'block-source'
  | 'query-header'
  | 'query-hint'
  | 'query-composer'
  | 'query-history'
  | 'query-answer'
  | 'query-citation'
  | 'data-sources-header'
  | 'data-sources-create'
  | 'data-source-detail-header'
  | 'data-source-audio-list'
  | 'data-source-transcribe'
  | 'group-settings-header'
  | 'group-settings-tabs'
  | 'group-settings-basic'
  | 'group-settings-tags'
  | 'group-settings-knowledge'
  | 'group-settings-sources'
  | 'group-settings-save'
  | 'group-settings-archive'
  | 'collection-entry'
  | 'collection-group'
  | 'collection-rules'
  | 'collection-rule-editor'
  | 'collection-history'
  | 'collection-cases'
  | 'collection-case-editor'
  | 'ai-security'
  | 'ai-configuration'
  | 'ai-demo-notice'
  | 'ai-demo-local-provider'
  | 'ai-demo-connections'
  | 'ai-demo-default-bindings'
  | 'ai-demo-capabilities'
  | 'ai-demo-legacy-env'
  | 'runtime-notice'
  | 'runtime-modes'
  | 'runtime-save'
  | 'example-overview'
  | 'example-transcript'
  | 'example-report';

export type GuideRoute =
  | 'group'
  | 'create'
  | 'more'
  | 'knowledge'
  | 'knowledge_detail_demo'
  | 'knowledge_document_demo'
  | 'knowledge_block_demo'
  | 'knowledge_query_demo'
  | 'data_sources'
  | 'group_settings'
  | 'collection'
  | 'collection_rules'
  | 'collection_rule_editor'
  | 'collection_history'
  | 'collection_cases'
  | 'collection_case_demo'
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
        target: 'group-tabs',
        title: '按页面标签完成工作流',
        body: '分组页聚合音频、知识库和数据源：音频负责产生分析素材，知识库提供可检索材料，数据源负责管理文件与处理状态。',
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
      {
        route: 'knowledge_detail_demo',
        target: 'knowledge-overview',
        title: '查看知识库详情',
        body: '详情页展示知识库用途、文档数量、文本块数量和关联分组；当前页面使用只读演示数据。',
      },
      {
        route: 'knowledge_detail_demo',
        target: 'knowledge-files',
        title: '管理知识库文档',
        body: '文档列表用于查看上传、解析和失败状态。引导只介绍入口，不上传文件、不触发解析。',
      },
      {
        route: 'knowledge_detail_demo',
        target: 'knowledge-upload',
        title: '添加文档',
        body: '真实页面可以从固定操作区选择 Markdown、文本、Word 或表格文档；引导中的按钮是禁用的，只展示位置。',
      },
      {
        route: 'knowledge_document_demo',
        target: 'knowledge-document-status',
        title: '了解文档处理状态',
        body: '文档详情会区分原始文件、解析结果和文本块。只有解析完成的文档才能继续查看文本块。',
      },
      {
        route: 'knowledge_document_demo',
        target: 'document-block-list',
        title: '查看文本块列表',
        body: '文本块是检索和引用的最小内容单元，列表可帮助你检查切分结果与来源位置。',
      },
      {
        route: 'knowledge_block_demo',
        target: 'block-content',
        title: '文本块详情',
        body: '文本块详情保留原文、元数据和上下文，便于确认这段内容是否适合被问答引用。',
      },
      {
        route: 'knowledge_block_demo',
        target: 'block-source',
        title: '定位原文来源',
        body: '从引用或文本块详情可以回到文档原文位置，核对回答依据。',
      },
    ],
  },
  knowledge_query: {
    id: 'knowledge_query',
    title: '问知识库引导',
    description: '从提问到引用核验，了解知识库问答的完整流程。',
    steps: [
      {
        route: 'knowledge_query_demo',
        target: 'query-header',
        title: '问知识库',
        body: '问知识库会根据已解析的文本块检索相关材料，再生成带引用的回答。当前使用只读演示数据。',
      },
      {
        route: 'knowledge_query_demo',
        target: 'query-hint',
        title: '先描述你要确认的事实',
        body: '问题越具体，检索范围越容易收敛；可以询问规则、流程、项目背景或文档中的明确结论。',
      },
      {
        route: 'knowledge_query_demo',
        target: 'query-composer',
        title: '输入并发送问题',
        body: '输入框和发送按钮用于真实问答。本引导只展示交互位置，不发送请求、不消耗模型额度。',
      },
      {
        route: 'knowledge_query_demo',
        target: 'query-answer',
        title: '查看回答进度与结果',
        body: '回答生成期间会展示进度，完成后请先看结论，再结合引用判断是否需要继续追问。',
      },
      {
        route: 'knowledge_query_demo',
        target: 'query-citation',
        title: '打开引用核验原文',
        body: '点击引用可进入对应文本块或文档位置，验证回答是否忠实于知识库内容。',
      },
      {
        route: 'knowledge_query_demo',
        target: 'query-history',
        title: '回看历史问题',
        body: '历史记录保存本知识库下的问答上下文，便于继续追问或复用常见问题。',
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
      {
        route: 'data_sources',
        target: 'data-source-detail-header',
        title: '打开数据源详情',
        body: '详情页集中展示数据源信息、关联分组以及其中的音频文件。',
      },
      {
        route: 'data_sources',
        target: 'data-source-audio-list',
        title: '查看音频状态',
        body: '每条音频会显示上传、处理中、转写完成或失败等状态，方便判断下一步操作。',
      },
      {
        route: 'data_sources',
        target: 'data-source-transcribe',
        title: '进入转写与分析',
        body: '处理完成的音频可以进入转写和分析入口；引导不会启动任何任务。',
      },
    ],
  },
  group_settings: {
    id: 'group_settings',
    title: '分组设置引导',
    description: '了解基本设置、分析标签、知识库和数据源关联。',
    steps: [
      {
        route: 'group_settings',
        target: 'group-settings-header',
        title: '分组设置总览',
        body: '分组设置决定这个工作空间如何组织音频、关联知识库，以及报告需要关注哪些分析标签。',
      },
      {
        route: 'group_settings',
        target: 'group-settings-tabs',
        title: '四类设置标签',
        body: '基本设置管理名称和分析偏好；分析标签定义关注维度；知识库设置关联问答材料；数据源设置管理音频入口。',
      },
      {
        route: 'group_settings',
        target: 'group-settings-basic',
        title: '基本设置',
        body: '在基本设置中调整分组名称、分析时机、内容侧重和报告语气，让后续分析更贴合团队习惯。',
      },
      {
        route: 'group_settings',
        target: 'group-settings-tags',
        title: '分析标签',
        body: '分析标签用于补充业务关心的维度，例如客户需求、异议处理或下一步行动。',
      },
      {
        route: 'group_settings',
        target: 'group-settings-knowledge',
        title: '知识库设置',
        body: '关联知识库后，分析和问答可以参考统一的业务材料；这里只切换到标签页查看说明，不修改关联。',
      },
      {
        route: 'group_settings',
        target: 'group-settings-sources',
        title: '数据源设置',
        body: '数据源设置决定哪些音频入口属于当前分组，便于统一查看处理状态和分析结果。',
      },
      {
        route: 'group_settings',
        target: 'group-settings-save',
        title: '保存设置',
        body: '确认修改后再保存，保存会影响之后的新任务。本引导不会提交表单。',
      },
      {
        route: 'group_settings',
        target: 'group-settings-archive',
        title: '归档分组',
        body: '归档适用于暂时停用的分组，历史数据仍可按产品规则保留；这是高影响操作，需要你主动确认。',
      },
    ],
  },
  knowledge_collection: {
    id: 'knowledge_collection',
    title: '知识收集引导',
    description: '从更多页进入知识收集，了解规则、补收和案例审核。',
    steps: [
      {
        route: 'more',
        target: 'collection-entry',
        title: '从更多页进入知识收集',
        body: '知识收集的唯一入口在更多页。分组设置不再提供跳转按钮，避免入口重复。',
      },
      {
        route: 'collection',
        target: 'collection-group',
        title: '选择目标分组',
        body: '先选择要沉淀知识的分组，后续规则和案例都会在该分组范围内生效。',
      },
      {
        route: 'collection_rules',
        target: 'collection-rules',
        title: '设置收集规则',
        body: '规则决定从哪些分析结果中提取候选知识，例如命中指定标签或出现高频问题。',
      },
      {
        route: 'collection_rule_editor',
        target: 'collection-rule-editor',
        title: '编辑规则条件',
        body: '编辑器用于配置触发条件和收集目标；引导只查看字段，不保存规则。',
      },
      {
        route: 'collection_history',
        target: 'collection-history',
        title: '查看历史补收',
        body: '历史补收可以针对过去的分析记录重新筛选候选内容，执行前请确认范围与影响。',
      },
      {
        route: 'collection_cases',
        target: 'collection-cases',
        title: '审核候选案例',
        body: '候选案例需要人工审核，确认内容、标签和来源后再决定是否进入知识库。',
      },
      {
        route: 'collection_case_demo',
        target: 'collection-case-editor',
        title: '编辑案例内容',
        body: '案例编辑可以修正文案、补充标签和核对来源。引导不会通过审核、发布或保存。',
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
      {
        route: 'ai_configuration',
        target: 'ai-demo-notice',
        title: '查看安全提示',
        body: '连接不是 HTTPS 时不能在页面提交 Credential。以下区域是脱敏静态演示，仅用于引导演示，不是实际配置。',
      },
      {
        route: 'ai_configuration',
        target: 'ai-demo-local-provider',
        title: 'Local Credential Provider',
        body: '本地 Credential Provider 负责读取受保护的本地配置文件；引导不会读取真实 Credential。',
      },
      {
        route: 'ai_configuration',
        target: 'ai-demo-connections',
        title: '供应商连接',
        body: '这里展示供应商名称、基础地址和脱敏别名。实际项目中应先确认连接安全，再单独维护供应商连接。',
      },
      {
        route: 'ai_configuration',
        target: 'ai-demo-default-bindings',
        title: '默认能力绑定',
        body: '默认绑定用于一次性补齐尚未配置的能力，例如 DashScope、DeepSeek 和阿里云 OSS。演示按钮不可操作。',
      },
      {
        route: 'ai_configuration',
        target: 'ai-demo-capabilities',
        title: '逐项配置模型能力',
        body: '知识嵌入、知识问答、音频转写、情绪分析、角色识别和业务分析可以分别绑定供应商与模型。',
      },
      {
        route: 'ai_configuration',
        target: 'ai-demo-legacy-env',
        title: '旧 .env 导入',
        body: '旧 .env 导入只适合迁移阶段，导入前应核对变量和权限；本引导不会执行导入。',
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

const guideTranslationPrefixes: Record<GuideId, string> = {
  basic: 'guide.basic',
  knowledge: 'guide.knowledge',
  knowledge_query: 'guide.knowledgeQuery',
  data_sources: 'guide.dataSources',
  group_settings: 'guide.groupSettings',
  knowledge_collection: 'guide.knowledgeCollection',
  ai_configuration: 'guide.ai',
  runtime_mode: 'guide.runtime',
  analysis: 'guide.analysis',
};

/** 在保留路由与目标结构的前提下，生成当前 App 语言的引导注册表。 */
export function localizeGuideRegistry(
  t: (key: TranslationKey, options?: Record<string, unknown>) => string,
): Record<GuideId, GuideDefinition> {
  return Object.fromEntries(
    GUIDE_IDS.map((id) => {
      const guide = GUIDE_REGISTRY[id];
      const prefix = guideTranslationPrefixes[id];
      return [
        id,
        {
          ...guide,
          title: translatedOrFallback(t, `${prefix}.title`, guide.title),
          description: translatedOrFallback(t, `${prefix}.description`, guide.description),
          // 文案跟随目标身份，新增或重排步骤不能把旧说明套到其他高亮区域上。
          steps: guide.steps.map((step) => ({
            ...step,
            title: translatedOrFallback(
              t,
              `${prefix}.steps.${step.target ?? step.route}.title`,
              step.title,
            ),
            body: translatedOrFallback(
              t,
              `${prefix}.steps.${step.target ?? step.route}.body`,
              step.body,
            ),
          })),
        },
      ];
    }),
  ) as unknown as Record<GuideId, GuideDefinition>;
}

/** 翻译资源尚未覆盖新引导时，保留注册表中的中文文案，避免界面显示 key。 */
function translatedOrFallback(
  t: (key: TranslationKey, options?: Record<string, unknown>) => string,
  key: string,
  fallback: string,
): string {
  const translated = t(key as TranslationKey);
  return translated === key || translated.startsWith('[missing ') ? fallback : translated;
}

export type WindowRect = { height: number; width: number; x: number; y: number };
export type LayoutRect = { height: number; left: number; top: number; width: number };

/** 将 measureInWindow 的窗口坐标转换为遮罩根节点的局部坐标。 */
export function windowRectToLocal(rect: WindowRect, root: WindowRect): WindowRect {
  return {
    height: rect.height,
    width: rect.width,
    x: rect.x - root.x,
    y: rect.y - root.y,
  };
}

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
