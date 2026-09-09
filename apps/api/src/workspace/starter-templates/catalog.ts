/**
 * 起步模板只读示例目录。
 *
 * 维护随产品版本发布的演示分析，不创建音频、任务、转写或分析数据库记录。
 *
 * Responsibilities:
 * - 为每个起步模板提供稳定且可验证的示例内容。
 * - 返回共享契约校验后的只读对象。
 *
 * Notes:
 * - 修改示例内容时必须递增对应 exampleVersion。
 */
import {
  TemplateExampleSchema,
  type StarterTemplateKey,
  type SupportedLanguage,
  type TemplateExample,
} from '@echowave/contracts';

const zhCNExamples: Record<StarterTemplateKey, TemplateExample> = {
  sales_call_review: TemplateExampleSchema.parse({
    templateKey: 'sales_call_review',
    exampleVersion: 1,
    title: 'B2B 首次需求沟通示例',
    scenario: '销售与客户围绕客服质检效率进行首次需求沟通，并约定下一次产品演示。',
    playbackAvailable: false,
    roles: [
      { id: 'sales', label: '销售' },
      { id: 'customer', label: '客户' },
    ],
    transcript: [
      {
        id: 's1',
        roleId: 'sales',
        roleLabel: '销售',
        emotion: '友好',
        startMs: 0,
        endMs: 12000,
        text: '想先了解一下，你们现在是怎样复盘客服通话的？',
      },
      {
        id: 's2',
        roleId: 'customer',
        roleLabel: '客户',
        emotion: '平静',
        startMs: 12000,
        endMs: 29000,
        text: '主管每周抽听，覆盖率不到百分之五，问题发现得比较晚。',
      },
      {
        id: 's3',
        roleId: 'sales',
        roleLabel: '销售',
        emotion: '专注',
        startMs: 29000,
        endMs: 44000,
        text: '如果问题晚一周发现，会对投诉或团队辅导造成什么影响？',
      },
      {
        id: 's4',
        roleId: 'customer',
        roleLabel: '客户',
        emotion: '担忧',
        startMs: 44000,
        endMs: 60000,
        text: '投诉已经发生，也错过了当周培训，主管大概要多花两天整理。',
      },
      {
        id: 's5',
        roleId: 'sales',
        roleLabel: '销售',
        emotion: '自信',
        startMs: 60000,
        endMs: 82000,
        text: '我们可以自动转写并按异议、情绪和风险聚合证据，让主管当天看到需要跟进的片段。',
      },
      {
        id: 's6',
        roleId: 'customer',
        roleLabel: '客户',
        emotion: '谨慎',
        startMs: 82000,
        endMs: 96000,
        text: '自动分析的准确性如果不稳定，主管反而要重新核对。',
      },
      {
        id: 's7',
        roleId: 'sales',
        roleLabel: '销售',
        emotion: '沉稳',
        startMs: 96000,
        endMs: 118000,
        text: '报告会引用原始转写和时间段，主管可以快速核验。下周二我用你们的脱敏样本演示一次，可以吗？',
      },
      {
        id: 's8',
        roleId: 'customer',
        roleLabel: '客户',
        emotion: '认可',
        startMs: 118000,
        endMs: 126000,
        text: '可以，下周二下午三点。',
      },
    ],
    summarySections: [
      {
        title: '沟通结果',
        body: '识别出抽检覆盖率低、反馈滞后的核心问题，并约定下周二下午三点进行脱敏样本演示。',
      },
      {
        title: '做得好的地方',
        body: '通过影响追问量化了投诉与培训延误，并用可核验的时间片段回应准确性异议。',
      },
      { title: '仍需确认', body: '本次未确认预算范围、决策链、采购节奏及关键干系人。' },
    ],
    analysisTags: [
      {
        kind: 'strength',
        title: '有效需求探索',
        detail: '从现状追问到业务影响，形成了清晰的问题链。',
        evidenceSegmentIds: ['s1', 's2', 's3', 's4'],
      },
      {
        kind: 'strength',
        title: '明确下一步',
        detail: '把后续动作落实到演示材料、日期和时间。',
        evidenceSegmentIds: ['s7', 's8'],
      },
      {
        kind: 'improvement',
        title: '决策信息不足',
        detail: '预算、决策链和关键干系人尚未确认，可能影响机会判断。',
        evidenceSegmentIds: ['s8'],
      },
    ],
    recommendations: [
      '演示前确认参与人及每位参与人的关注点。',
      '补问当前质检成本、预算窗口与最终决策人。',
      '演示时用客户脱敏样本对比人工抽检耗时和证据准确性。',
    ],
    limitations: ['本示例为产品演示内容，不代表真实客户、真实录音或模型运行结果。'],
  }),
  personal_speaking_coach: TemplateExampleSchema.parse({
    templateKey: 'personal_speaking_coach',
    exampleVersion: 1,
    title: '两分钟自我介绍示例',
    scenario: '求职者进行两分钟自我介绍，覆盖开场、经历、能力证明与目标表达。',
    playbackAvailable: false,
    roles: [{ id: 'speaker', label: '演讲者' }],
    transcript: [
      {
        id: 'p1',
        roleId: 'speaker',
        roleLabel: '演讲者',
        emotion: '略紧张',
        startMs: 0,
        endMs: 17000,
        text: '大家好，我是林晨，过去三年一直在做企业服务产品。',
      },
      {
        id: 'p2',
        roleId: 'speaker',
        roleLabel: '演讲者',
        emotion: '平静',
        startMs: 17000,
        endMs: 47000,
        text: '我负责过客户反馈平台，嗯，从调研到上线都参与了，也和销售、交付团队一起工作。',
      },
      {
        id: 'p3',
        roleId: 'speaker',
        roleLabel: '演讲者',
        emotion: '自信',
        startMs: 47000,
        endMs: 77000,
        text: '上线半年后，工单定位时间缩短了百分之四十，这是我把复杂问题拆成可执行流程的一个例子。',
      },
      {
        id: 'p4',
        roleId: 'speaker',
        roleLabel: '演讲者',
        emotion: '期待',
        startMs: 77000,
        endMs: 108000,
        text: '我希望在新的团队继续做能产生清晰业务价值的产品，也期待把这套跨团队协作经验带到岗位中。',
      },
    ],
    summarySections: [
      { title: '结构', body: '开场身份、相关经历、量化能力证明和求职目标完整，主线清楚。' },
      {
        title: '表达表现',
        body: '整体清晰、语速稳定；中段出现一次“嗯”，开场略紧张，结尾感染力仍可加强。',
      },
      { title: '核心优势', body: '用“定位时间缩短 40%”支撑能力，比只描述职责更有说服力。' },
    ],
    analysisTags: [
      {
        kind: 'strength',
        title: '量化能力证明',
        detail: '结果数据让复杂问题拆解能力更可信。',
        evidenceSegmentIds: ['p3'],
      },
      {
        kind: 'improvement',
        title: '减少口头禅',
        detail: '中段停顿可直接删除，使经历陈述更紧凑。',
        evidenceSegmentIds: ['p2'],
      },
      {
        kind: 'action',
        title: '增强结尾感染力',
        detail: '将泛化目标改为岗位价值承诺。',
        evidenceSegmentIds: ['p4'],
      },
    ],
    recommendations: [
      '把第二段改为：“我从用户调研推进到上线，并协同销售与交付闭环客户反馈。”',
      '把结尾改为：“我希望用这套经验，帮助团队更快把客户问题转成可验证的产品结果。”',
      '练习时在开场后停顿一秒，并将全篇控制在每分钟 220 至 260 字。',
    ],
    limitations: ['本示例不包含原始音频，语速与情绪描述仅用于展示报告结构。'],
  }),
};

const enExamples: Record<StarterTemplateKey, TemplateExample> = {
  sales_call_review: TemplateExampleSchema.parse({
    templateKey: 'sales_call_review',
    exampleVersion: 1,
    title: 'B2B discovery call example',
    scenario:
      'A sales representative and customer discuss contact-center quality review efficiency and agree on a product demo.',
    playbackAvailable: false,
    roles: [
      { id: 'sales', label: 'Sales' },
      { id: 'customer', label: 'Customer' },
    ],
    transcript: [
      {
        id: 's1',
        roleId: 'sales',
        roleLabel: 'Sales',
        emotion: 'Friendly',
        startMs: 0,
        endMs: 12000,
        text: 'Could you walk me through how you review customer-service calls today?',
      },
      {
        id: 's2',
        roleId: 'customer',
        roleLabel: 'Customer',
        emotion: 'Calm',
        startMs: 12000,
        endMs: 29000,
        text: 'Supervisors sample calls each week. Coverage is under five percent, so we find issues quite late.',
      },
      {
        id: 's3',
        roleId: 'sales',
        roleLabel: 'Sales',
        emotion: 'Focused',
        startMs: 29000,
        endMs: 44000,
        text: 'What impact does finding an issue a week late have on complaints or team coaching?',
      },
      {
        id: 's4',
        roleId: 'customer',
        roleLabel: 'Customer',
        emotion: 'Concerned',
        startMs: 44000,
        endMs: 60000,
        text: 'The complaint has already happened, that week’s training opportunity is gone, and supervisors spend about two days compiling everything.',
      },
      {
        id: 's5',
        roleId: 'sales',
        roleLabel: 'Sales',
        emotion: 'Confident',
        startMs: 60000,
        endMs: 82000,
        text: 'We can transcribe calls automatically and group evidence by objections, emotion, and risk so supervisors see the relevant segments the same day.',
      },
      {
        id: 's6',
        roleId: 'customer',
        roleLabel: 'Customer',
        emotion: 'Cautious',
        startMs: 82000,
        endMs: 96000,
        text: 'If the automated analysis is inconsistent, supervisors will still have to verify everything again.',
      },
      {
        id: 's7',
        roleId: 'sales',
        roleLabel: 'Sales',
        emotion: 'Composed',
        startMs: 96000,
        endMs: 118000,
        text: 'Each report cites the original transcript and time range for quick review. Could I demonstrate it next Tuesday with one of your anonymized samples?',
      },
      {
        id: 's8',
        roleId: 'customer',
        roleLabel: 'Customer',
        emotion: 'Positive',
        startMs: 118000,
        endMs: 126000,
        text: 'Yes, next Tuesday at 3 p.m.',
      },
    ],
    summarySections: [
      {
        title: 'Outcome',
        body: 'The call identified low review coverage and delayed feedback as core problems, then scheduled an anonymized-sample demo for next Tuesday at 3 p.m.',
      },
      {
        title: 'What worked well',
        body: 'Impact questions quantified complaint and training delays, while time-linked evidence addressed the accuracy objection.',
      },
      {
        title: 'Still to confirm',
        body: 'Budget, decision process, purchasing timeline, and key stakeholders were not confirmed.',
      },
    ],
    analysisTags: [
      {
        kind: 'strength',
        title: 'Effective discovery',
        detail:
          'The conversation moved from the current process to business impact through a clear question sequence.',
        evidenceSegmentIds: ['s1', 's2', 's3', 's4'],
      },
      {
        kind: 'strength',
        title: 'Clear next step',
        detail: 'The follow-up was defined with the demo material, date, and time.',
        evidenceSegmentIds: ['s7', 's8'],
      },
      {
        kind: 'improvement',
        title: 'Insufficient decision context',
        detail:
          'Missing budget, decision-process, and stakeholder details may limit opportunity assessment.',
        evidenceSegmentIds: ['s8'],
      },
    ],
    recommendations: [
      'Confirm the attendees and each person’s priorities before the demo.',
      'Ask about current review costs, the budget window, and the final decision-maker.',
      'Use the customer’s anonymized sample to compare manual review time and evidence accuracy.',
    ],
    limitations: [
      'This is product demonstration content and does not represent a real customer, recording, or model run.',
    ],
  }),
  personal_speaking_coach: TemplateExampleSchema.parse({
    templateKey: 'personal_speaking_coach',
    exampleVersion: 1,
    title: 'Two-minute introduction example',
    scenario:
      'A job candidate gives a two-minute introduction covering an opening, experience, evidence of ability, and career goals.',
    playbackAvailable: false,
    roles: [{ id: 'speaker', label: 'Speaker' }],
    transcript: [
      {
        id: 'p1',
        roleId: 'speaker',
        roleLabel: 'Speaker',
        emotion: 'Slightly nervous',
        startMs: 0,
        endMs: 17000,
        text: 'Hello, I’m Lin Chen. I’ve spent the past three years building enterprise software products.',
      },
      {
        id: 'p2',
        roleId: 'speaker',
        roleLabel: 'Speaker',
        emotion: 'Calm',
        startMs: 17000,
        endMs: 47000,
        text: 'I worked on a customer-feedback platform, um, from research through launch, collaborating with sales and delivery teams.',
      },
      {
        id: 'p3',
        roleId: 'speaker',
        roleLabel: 'Speaker',
        emotion: 'Confident',
        startMs: 47000,
        endMs: 77000,
        text: 'Six months after launch, ticket diagnosis time fell by forty percent. That is one example of how I turn complex problems into executable processes.',
      },
      {
        id: 'p4',
        roleId: 'speaker',
        roleLabel: 'Speaker',
        emotion: 'Optimistic',
        startMs: 77000,
        endMs: 108000,
        text: 'I want to keep building products with clear business value and bring this cross-functional experience to my next team.',
      },
    ],
    summarySections: [
      {
        title: 'Structure',
        body: 'The introduction has a clear through-line: identity, relevant experience, quantified evidence, and career goal.',
      },
      {
        title: 'Delivery',
        body: 'The delivery is generally clear and steady. There is one filler word in the middle, mild nervousness at the start, and room for a stronger close.',
      },
      {
        title: 'Core strength',
        body: 'The forty-percent reduction in diagnosis time demonstrates ability more convincingly than responsibilities alone.',
      },
    ],
    analysisTags: [
      {
        kind: 'strength',
        title: 'Quantified evidence',
        detail: 'The outcome metric makes the claim about solving complex problems more credible.',
        evidenceSegmentIds: ['p3'],
      },
      {
        kind: 'improvement',
        title: 'Reduce filler words',
        detail:
          'Removing the mid-sentence hesitation would make the experience summary more concise.',
        evidenceSegmentIds: ['p2'],
      },
      {
        kind: 'action',
        title: 'Strengthen the close',
        detail: 'Replace the general goal with a role-specific value commitment.',
        evidenceSegmentIds: ['p4'],
      },
    ],
    recommendations: [
      'Revise the second segment to: “I led the work from user research through launch and partnered with sales and delivery to close the customer-feedback loop.”',
      'Revise the close to: “I want to use this experience to help the team turn customer problems into validated product outcomes faster.”',
      'Pause for one second after the opening and keep the full introduction between 130 and 155 words per minute.',
    ],
    limitations: [
      'This example has no original audio; pace and emotion descriptions only demonstrate the report structure.',
    ],
  }),
};

/** 按模板标识读取产品内置示例。 */
export function getStarterTemplateExample(
  key: StarterTemplateKey,
  language: SupportedLanguage = 'zh-CN',
): TemplateExample {
  return language === 'en' ? enExamples[key] : zhCNExamples[key];
}
