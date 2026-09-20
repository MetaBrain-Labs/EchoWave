/**
 * AI 配置中心页面。
 *
 * 提供内存管理员会话、双 Credential Provider、供应商连接、能力绑定和旧环境导入。
 *
 * Responsibilities:
 * - 在渲染 Secret 控件前读取服务端安全状态并执行禁用策略。
 * - 允许不安全远程 HTTP 继续修改普通配置和 Local alias。
 * - 处理认证、冲突、超时、网络失败与显式重试。
 *
 * Notes:
 * - 管理口令保存在根级共享内存会话，页面卸载不恢复；换服务器时由 Provider 统一失效。
 */
import {
  AI_CAPABILITY_DEFAULTS,
  AI_CAPABILITY_PROVIDER_PREFERENCES,
  CAPABILITY_MODEL_REQUIREMENTS,
  supportsThinkingSetting,
  type AiCapability,
  type ModelCatalogResponse,
  type ProviderConnection,
  type ProviderConnectionWrite,
  type ProviderModelSummary,
  type ProviderType,
  type SettingsOverview,
  type TransportSecurityMode,
} from '@echowave/contracts';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { settingsApi } from '@/shared/api/settingsApi';
import { WorkspaceRequestError } from '@/shared/api/request';
import { AdminSessionGate } from '@/shared/auth/AdminSessionGate';
import { useAdminSession } from '@/shared/auth/AdminSessionProvider';
import { useScreenRefresh } from '@/shared/hooks/useScreenRefresh';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { PageHeader } from '@/shared/ui/PageHeader';
import { GuideButton } from '@/shared/ui/GuideButton';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import { useStarterTour, useStarterTourTarget } from '@/shared/onboarding/StarterTourContext';
import { ActionSheet } from '@/shared/ui/ActionSheet';
import { textInputText } from '@/shared/theme/textInput';

const capabilities: readonly { id: AiCapability }[] = [
  { id: 'knowledge_embedding' },
  { id: 'knowledge_chat' },
  { id: 'audio_transcription' },
  { id: 'audio_emotion' },
  { id: 'audio_role' },
  { id: 'audio_speaker_review' },
  { id: 'business_analysis' },
  { id: 'audio_staging' },
  { id: 'audio_primary_storage' },
];

const providerTypes = ['dashscope', 'deepseek', 'aliyun_oss'] as const;

type DefaultApplySummary = {
  applied: number;
  skipped: number;
  failedCapabilities: AiCapability[];
};

type TranslationFunction = ReturnType<typeof useAppLanguage>['t'];

function providerLabel(type: ProviderType, t: TranslationFunction): string {
  return type === 'dashscope'
    ? t('aiSettings.providerQwen')
    : type === 'deepseek'
      ? t('aiSettings.providerDeepSeek')
      : t('aiSettings.alibabaOss');
}

function capabilityLabel(capability: AiCapability, t: TranslationFunction): string {
  const keys = {
    knowledge_embedding: 'aiSettings.capEmbedding',
    knowledge_chat: 'aiSettings.capChat',
    audio_transcription: 'aiSettings.capTranscription',
    audio_emotion: 'aiSettings.capEmotion',
    audio_role: 'aiSettings.capRole',
    audio_speaker_review: 'aiSettings.capSpeakerReview',
    business_analysis: 'aiSettings.capBusiness',
    audio_staging: 'aiSettings.capStaging',
    audio_primary_storage: 'aiSettings.capPrimaryStorage',
  } as const;
  return t(keys[capability]);
}

type ProviderDraft = {
  editingId: string | null;
  expectedRevision?: number;
  type: ProviderType;
  name: string;
  baseUrl: string;
  compatibleBaseUrl: string;
  notifyMode: 'polling' | 'eventbridge';
  callbackUrl: string;
  region: string;
  bucket: string;
  credentialSource: 'database' | 'local_file';
  alias: string;
  apiKey: string;
  callbackToken: string;
  accessKeyId: string;
  accessKeySecret: string;
};

type ProviderDraftDefaults = Pick<
  ProviderDraft,
  | 'baseUrl'
  | 'compatibleBaseUrl'
  | 'notifyMode'
  | 'callbackUrl'
  | 'region'
  | 'bucket'
  | 'apiKey'
  | 'callbackToken'
  | 'accessKeyId'
  | 'accessKeySecret'
>;

const providerDraftDefaults: Record<ProviderType, ProviderDraftDefaults> = {
  dashscope: {
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    compatibleBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    notifyMode: 'polling',
    callbackUrl: '',
    region: '',
    bucket: '',
    apiKey: '',
    callbackToken: '',
    accessKeyId: '',
    accessKeySecret: '',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    compatibleBaseUrl: '',
    notifyMode: 'polling',
    callbackUrl: '',
    region: '',
    bucket: '',
    apiKey: '',
    callbackToken: '',
    accessKeyId: '',
    accessKeySecret: '',
  },
  aliyun_oss: {
    baseUrl: '',
    compatibleBaseUrl: '',
    notifyMode: 'polling',
    callbackUrl: '',
    region: 'oss-cn-beijing',
    bucket: '',
    apiKey: '',
    callbackToken: '',
    accessKeyId: '',
    accessKeySecret: '',
  },
};

function draftForProviderType(type: ProviderType): ProviderDraft {
  return {
    editingId: null,
    type,
    name: '',
    credentialSource: 'local_file',
    alias: '',
    ...providerDraftDefaults[type],
  };
}

const emptyDraft = (): ProviderDraft => ({
  ...draftForProviderType('dashscope'),
});

/** 切换供应商时保留连接身份，但清理所有目标类型不适用的编辑内容。 */
function switchProviderType(draft: ProviderDraft, type: ProviderType): ProviderDraft {
  if (draft.type === type) return draft;
  return {
    ...draftForProviderType(type),
    editingId: draft.editingId,
    expectedRevision: draft.expectedRevision,
    name: draft.name,
    credentialSource: draft.credentialSource,
  };
}

function errorMessage(error: unknown, t: TranslationFunction): string {
  if (error instanceof WorkspaceRequestError) {
    if (error.code === 'CONFLICT') return t('aiSettings.conflict', { message: error.message });
    if (error.code === 'UNAUTHORIZED') return t('aiSettings.unauthorized');
    if (error.code === 'INSECURE_CREDENTIAL_TRANSPORT') return t('aiSettings.insecure');
    return error.message;
  }
  return t('aiSettings.operationFailed');
}

function draftFromProvider(provider: ProviderConnection): ProviderDraft {
  const draft = draftForProviderType(provider.type);
  const config = provider.config as Record<string, unknown>;
  return {
    ...draft,
    editingId: provider.id,
    expectedRevision: provider.revision,
    type: provider.type,
    name: provider.name,
    baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl : draft.baseUrl,
    compatibleBaseUrl:
      typeof config.compatibleBaseUrl === 'string'
        ? config.compatibleBaseUrl
        : draft.compatibleBaseUrl,
    notifyMode: config.asyncNotifyMode === 'eventbridge' ? 'eventbridge' : 'polling',
    callbackUrl:
      typeof config.eventBridgeCallbackUrl === 'string' ? config.eventBridgeCallbackUrl : '',
    region: typeof config.region === 'string' ? config.region : draft.region,
    bucket: typeof config.bucket === 'string' ? config.bucket : '',
    credentialSource: provider.credential.source,
    alias: provider.credential.alias ?? '',
  };
}

function providerInput(draft: ProviderDraft): ProviderConnectionWrite {
  const config =
    draft.type === 'dashscope'
      ? {
          baseUrl: draft.baseUrl.trim(),
          compatibleBaseUrl: draft.compatibleBaseUrl.trim(),
          asyncNotifyMode: draft.notifyMode,
          eventBridgeCallbackUrl:
            draft.notifyMode === 'eventbridge' ? draft.callbackUrl.trim() : null,
        }
      : draft.type === 'deepseek'
        ? { baseUrl: draft.baseUrl.trim() }
        : { region: draft.region.trim(), bucket: draft.bucket.trim() };
  const credential =
    draft.credentialSource === 'local_file'
      ? undefined
      : draft.type === 'aliyun_oss'
        ? draft.accessKeyId || draft.accessKeySecret
          ? { accessKeyId: draft.accessKeyId, accessKeySecret: draft.accessKeySecret }
          : undefined
        : draft.apiKey || draft.callbackToken
          ? {
              apiKey: draft.apiKey,
              ...(draft.type === 'dashscope' && draft.callbackToken
                ? { eventBridgeCallbackToken: draft.callbackToken }
                : {}),
            }
          : undefined;
  return {
    type: draft.type,
    name: draft.name.trim(),
    config,
    credentialSource: draft.credentialSource,
    ...(draft.credentialSource === 'local_file' ? { localCredentialAlias: draft.alias } : {}),
    ...(credential ? { credential } : {}),
    ...(draft.expectedRevision ? { expectedRevision: draft.expectedRevision } : {}),
  } as ProviderConnectionWrite;
}

/** 展示 AI 配置引导的脱敏静态区域，不读取真实 Credential，也不提交任何请求。 */
function AiConfigurationGuideDemo() {
  const noticeRef = useStarterTourTarget('ai-demo-notice');
  const localProviderRef = useStarterTourTarget('ai-demo-local-provider');
  const connectionsRef = useStarterTourTarget('ai-demo-connections');
  const defaultsRef = useStarterTourTarget('ai-demo-default-bindings');
  const capabilitiesRef = useStarterTourTarget('ai-demo-capabilities');
  const legacyRef = useStarterTourTarget('ai-demo-legacy-env');
  const demoConnections = [
    ['旧环境 阿里云 OSS', '阿里云 OSS · Database · ••••••LdFu'],
    ['旧环境 DeepSeek', 'DeepSeek · Database · ••••••cd79'],
    ['旧环境 DashScope', 'DashScope · Database · ••••••doJW'],
  ];
  const demoCapabilities = [
    ['知识嵌入', '旧环境 DashScope · demo-qwen-text-embedding'],
    ['知识问答', '旧环境 DeepSeek · demo-deepseek-chat'],
    ['音频转写', '旧环境 DashScope · demo-qwen-audio-transcription'],
    ['情绪分析', '旧环境 DashScope · demo-qwen-omni-analysis'],
    ['角色识别', '旧环境 DeepSeek · demo-deepseek-role'],
    ['业务分析', '旧环境 DeepSeek · demo-deepseek-business'],
    ['临时 OSS', '旧环境 阿里云 OSS · demo-aliyun-oss'],
  ];
  return (
    <View style={styles.demoPanel} testID="ai-configuration-guide-demo">
      <View collapsable={false} ref={noticeRef} style={styles.demoNotice}>
        <Text style={styles.demoNoticeTitle}>仅用于引导演示，不是实际配置</Text>
        <Text style={styles.help}>
          以下内容是脱敏模拟值，仅帮助你理解页面结构。不会读取真实 Credential、调用保存接口或修改 AI
          配置。
        </Text>
      </View>
      <View collapsable={false} ref={localProviderRef} style={styles.demoCard}>
        <Text style={styles.rowTitle}>Local Credential Provider</Text>
        <Text style={styles.help}>文件异常时应检查本地 Credential 文件的 YAML 结构和权限。</Text>
      </View>
      <View collapsable={false} ref={connectionsRef} style={styles.demoCard}>
        <Text style={styles.sectionTitle}>供应商连接</Text>
        {demoConnections.map(([name, detail]) => (
          <View key={name} style={styles.listRow}>
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>{name}</Text>
              <Text style={styles.help}>{detail}</Text>
            </View>
            <Text style={styles.link}>修改（演示）</Text>
          </View>
        ))}
        <Text style={styles.link}>添加连接（演示）</Text>
      </View>
      <View collapsable={false} ref={defaultsRef} style={styles.demoCard}>
        <Text style={styles.sectionTitle}>默认能力配置</Text>
        <Text style={styles.help}>
          选择兼容供应商后，可以一次补齐尚未配置的能力；演示按钮不可操作。
        </Text>
        {[
          'DashScope · 旧环境 DashScope',
          'DeepSeek · 旧环境 DeepSeek',
          '阿里云 OSS · 旧环境阿里云 OSS',
        ].map((value) => (
          <View key={value} style={styles.demoChoice}>
            <Text style={styles.choiceText}>{value}</Text>
          </View>
        ))}
        <View style={[styles.demoApplyButton, styles.disabled]}>
          <Text style={styles.demoApplyText}>应用默认配置（演示）</Text>
        </View>
      </View>
      <View collapsable={false} ref={capabilitiesRef} style={styles.demoCard}>
        <Text style={styles.sectionTitle}>能力绑定</Text>
        {demoCapabilities.map(([name, detail]) => (
          <View key={name} style={styles.listRow}>
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>{name}</Text>
              <Text style={styles.help}>{detail}</Text>
            </View>
            <Text style={styles.link}>设置（演示）</Text>
          </View>
        ))}
      </View>
      <View collapsable={false} ref={legacyRef} style={styles.demoCard}>
        <Text style={styles.sectionTitle}>旧 .env 导入</Text>
        <Text style={styles.help}>演示状态：已发现 3 项变量，未执行导入。</Text>
      </View>
    </View>
  );
}

/** 渲染配置中心并将返回与校验入口交给路由层。 */
export function SettingsScreen({
  onBack,
  onOpenServiceConfiguration,
}: {
  onBack: () => void;
  onOpenServiceConfiguration: () => void;
}) {
  const { formatDateTime, formatNumber, t } = useAppLanguage();
  const { activeGuide } = useStarterTour();
  const securityTourRef = useStarterTourTarget('ai-security');
  const configurationTourRef = useStarterTourTarget('ai-configuration');
  const { token, clearSession } = useAdminSession();
  const [overview, setOverview] = useState<SettingsOverview | null>(null);
  const [transportMode, setTransportMode] = useState<TransportSecurityMode | null>(null);
  const [secretAllowed, setSecretAllowed] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [providerEditorExpanded, setProviderEditorExpanded] = useState(false);
  const [defaultProviderChoices, setDefaultProviderChoices] = useState<
    Partial<Record<ProviderType, string>>
  >({});
  const [defaultApplySummary, setDefaultApplySummary] = useState<DefaultApplySummary | null>(null);
  const [bindingCapability, setBindingCapability] = useState<AiCapability | null>(null);
  const [bindingProviderId, setBindingProviderId] = useState('');
  const [bindingModel, setBindingModel] = useState('');
  const [bindingThinking, setBindingThinking] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [catalog, setCatalog] = useState<ModelCatalogResponse | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionsVisible, setActionsVisible] = useState(false);

  useEffect(() => {
    settingsApi
      .transport()
      .then((value) => {
        setTransportMode(value.mode);
        setSecretAllowed(value.secretSubmissionAllowed);
      })
      .catch((reason) => setError(errorMessage(reason, t)));
  }, [t]);

  const refresh = async (activeToken = token) => {
    if (!activeToken) return;
    setBusy(true);
    setError(null);
    try {
      const value = await settingsApi.overview(activeToken);
      setOverview(value);
      setTransportMode(value.transport.mode);
      setSecretAllowed(value.transport.secretSubmissionAllowed);
    } catch (reason) {
      setError(errorMessage(reason, t));
      if (reason instanceof WorkspaceRequestError && reason.code === 'UNAUTHORIZED') {
        clearSession();
        setOverview(null);
      }
    } finally {
      setBusy(false);
    }
  };
  const refreshPage = async () => {
    try {
      const transport = await settingsApi.transport();
      setTransportMode(transport.mode);
      setSecretAllowed(transport.secretSubmissionAllowed);
      if (token) await refresh(token);
      else setError(null);
    } catch (reason) {
      setError(errorMessage(reason, t));
    }
  };
  const screenRefresh = useScreenRefresh(refreshPage);

  // 共享会话可能由其他配置页建立；进入本页时用已校验口令补拉概览，避免重复输入。
  // 先 await 再写入状态，避免在 effect 内同步触发级联渲染。
  useEffect(() => {
    if (!token) return;
    let active = true;
    void settingsApi
      .overview(token)
      .then((value) => {
        if (!active) return;
        setOverview(value);
        setTransportMode(value.transport.mode);
        setSecretAllowed(value.transport.secretSubmissionAllowed);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(errorMessage(reason, t));
        if (reason instanceof WorkspaceRequestError && reason.code === 'UNAUTHORIZED') {
          clearSession();
          setOverview(null);
        }
      });
    return () => {
      active = false;
    };
    // 只在口令变化时补拉；页面内的保存与刷新仍走 refresh/refreshPage。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // 口令校验集中在“服务配置”页；本页只消费已建立的共享会话。
  const clearAdminSession = () => {
    clearSession();
    setOverview(null);
    setDraft(emptyDraft());
    setProviderEditorExpanded(false);
    setBindingCapability(null);
    setDefaultApplySummary(null);
    setCatalog(null);
    setCatalogError(null);
    setModelPickerOpen(false);
    setError(null);
  };

  /** 懒加载：只在打开模型弹窗或显式重试时才请求供应商模型目录。 */
  const retryCatalog = () => {
    setCatalogLoading(true);
    setCatalogRevision((current) => current + 1);
  };

  const openModelPicker = () => {
    setModelPickerOpen(true);
    if (!catalog) {
      setCatalogLoading(true);
      setCatalogRevision((current) => current + 1);
    }
  };

  // 目录读取是外部系统的反应性同步：effect 只订阅结果，加载态由打开弹窗或重试时置位。
  useEffect(() => {
    if (!token || !bindingCapability || !catalogRevision) return;
    let active = true;
    void settingsApi
      .modelCatalog(token, bindingCapability)
      .then((value) => {
        if (!active) return;
        setCatalog(value);
        setCatalogError(null);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setCatalog(null);
        setCatalogError(errorMessage(reason, t));
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });
    return () => {
      active = false;
    };
    // 只在打开弹窗或显式重试时拉取；同一能力与供应商组合复用同一份目录。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, bindingCapability, catalogRevision]);

  const saveProvider = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const input = providerInput(draft);
      if (draft.editingId) await settingsApi.updateProvider(token, draft.editingId, input);
      else await settingsApi.createProvider(token, input);
      setDraft(emptyDraft());
      setProviderEditorExpanded(false);
      await refresh(token);
    } catch (reason) {
      setError(errorMessage(reason, t));
    } finally {
      setBusy(false);
    }
  };

  const beginBinding = (capability: AiCapability) => {
    if (bindingCapability === capability) {
      setBindingCapability(null);
      setModelPickerOpen(false);
      return;
    }
    const current = overview?.bindings.find((item) => item.capability === capability);
    const compatible =
      overview?.providers.filter(({ type }) =>
        (AI_CAPABILITY_PROVIDER_PREFERENCES[capability] as readonly ProviderType[]).includes(type),
      ) ?? [];
    const preferred = compatible.find(
      ({ type }) => type === AI_CAPABILITY_PROVIDER_PREFERENCES[capability][0],
    );
    setBindingCapability(capability);
    setBindingProviderId(current?.providerConnectionId ?? (preferred ?? compatible[0])?.id ?? '');
    setBindingThinking(current?.settings.enableThinking === true);
    setBindingModel(current?.model ?? AI_CAPABILITY_DEFAULTS[capability].model);
    setModelSearch('');
    // 目录延后到用户真正打开模型弹窗时再读取，避免展开面板即产生供应商请求。
    setModelPickerOpen(false);
    setCatalog(null);
    setCatalogError(null);
    setCatalogLoading(false);
    setCatalogRevision(0);
  };

  const saveBinding = async () => {
    if (!token || !bindingCapability || !bindingProviderId) return;
    const current = overview?.bindings.find((item) => item.capability === bindingCapability);
    setBusy(true);
    setError(null);
    try {
      await settingsApi.saveCapability(token, bindingCapability, {
        providerConnectionId: bindingProviderId,
        secondaryProviderConnectionId: null,
        model: bindingModel || AI_CAPABILITY_DEFAULTS[bindingCapability].model,
        settings: supportsThinkingSetting(bindingCapability)
          ? { enableThinking: bindingThinking }
          : {},
        ...(current ? { expectedRevision: current.revision } : {}),
      });
      setBindingCapability(null);
      await refresh(token);
    } catch (reason) {
      setError(errorMessage(reason, t));
    } finally {
      setBusy(false);
    }
  };

  const compatibleProviders = useMemo(() => {
    const required = bindingCapability
      ? (AI_CAPABILITY_PROVIDER_PREFERENCES[bindingCapability] as readonly ProviderType[])
      : undefined;
    return (
      overview?.providers.filter(({ type }) => (!required ? false : required.includes(type))) ?? []
    );
  }, [bindingCapability, overview]);

  /** 当前供应商在该能力下的目录；未加载时为 null。 */
  const activeCatalog = useMemo(
    () =>
      catalog?.providers.find((provider) => provider.connectionId === bindingProviderId) ?? null,
    [bindingProviderId, catalog],
  );

  const pickerModels = useMemo(() => {
    if (!activeCatalog || activeCatalog.catalogAvailable === false) return [];
    const keyword = modelSearch.trim().toLowerCase();
    if (!keyword) return activeCatalog.models;
    return activeCatalog.models.filter(
      (model) =>
        model.id.toLowerCase().includes(keyword) ||
        model.displayName.toLowerCase().includes(keyword),
    );
  }, [activeCatalog, modelSearch]);

  const selectedModel = activeCatalog?.models.find((model) => model.id === bindingModel) ?? null;

  const pickerStatus: 'loading' | 'error' | 'unavailable' | 'ready' = catalogLoading
    ? 'loading'
    : catalogError
      ? 'error'
      : activeCatalog?.catalogAvailable === false
        ? 'unavailable'
        : 'ready';

  const selectedDefaultProvider = (type: ProviderType): string | undefined => {
    const compatible = overview?.providers.filter((provider) => provider.type === type) ?? [];
    const selected = defaultProviderChoices[type];
    if (selected && compatible.some((provider) => provider.id === selected)) return selected;
    return compatible.length === 1 ? compatible[0]!.id : undefined;
  };

  const missingCapabilities = capabilities.filter(
    ({ id }) => !overview?.bindings.some((binding) => binding.capability === id),
  );
  const defaultTargets = missingCapabilities.flatMap(({ id }) => {
    const preferred = AI_CAPABILITY_PROVIDER_PREFERENCES[id];
    const providerConnectionId =
      preferred
        .map((type) => selectedDefaultProvider(type))
        .find((candidate) => candidate !== undefined) ?? undefined;
    return providerConnectionId ? [{ capability: id, providerConnectionId }] : [];
  });

  /** 使用共享默认值补齐可配置的缺失能力，并公开每项请求的真实结果。 */
  const applyDefaultBindings = async () => {
    if (!token || defaultTargets.length === 0) return;
    setBusy(true);
    setError(null);
    setDefaultApplySummary(null);
    const results = await Promise.allSettled(
      defaultTargets.map(({ capability, providerConnectionId }) =>
        settingsApi.saveCapability(token, capability, {
          providerConnectionId,
          secondaryProviderConnectionId: null,
          model: AI_CAPABILITY_DEFAULTS[capability].model,
          settings: AI_CAPABILITY_DEFAULTS[capability].settings,
        }),
      ),
    );
    const failedCapabilities = results.flatMap((result, index) =>
      result.status === 'rejected' ? [defaultTargets[index]!.capability] : [],
    );
    await refresh(token);
    setDefaultApplySummary({
      applied: defaultTargets.length - failedCapabilities.length,
      skipped: missingCapabilities.length - defaultTargets.length,
      failedCapabilities,
    });
    setBusy(false);
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <PageHeader
        guide={
          <GuideButton
            content={{ guide: 'ai_configuration', kind: 'tour', returnTo: '/settings' }}
            testID="ai-configuration-guide"
          />
        }
        moreLabel={t('aiSettings.moreActions')}
        onBack={onBack}
        onMore={() => setActionsVisible(true)}
        title={t('aiSettings.title')}
      />
      <ScrollView
        alwaysBounceVertical
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<ScreenRefreshControl {...screenRefresh} />}
      >
        {activeGuide === 'ai_configuration' ? <AiConfigurationGuideDemo /> : null}
        <View collapsable={false} ref={securityTourRef}>
          <SecurityBanner mode={transportMode} secretAllowed={secretAllowed} />
        </View>
        {error ? (
          <View accessibilityRole="alert" style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            {token ? (
              <ActionButton label={t('aiSettings.refresh')} onPress={() => void refresh()} />
            ) : null}
          </View>
        ) : null}
        <View collapsable={false} ref={configurationTourRef}>
          {!token ? (
            <AdminSessionGate onOpenServiceConfiguration={onOpenServiceConfiguration} />
          ) : overview ? (
            <>
              <LocalProviderCard overview={overview} />
              <Section title={t('aiSettings.connections')}>
                {overview.providers.map((provider) => (
                  <Pressable
                    accessibilityRole="button"
                    key={provider.id}
                    onPress={() => {
                      setDraft(draftFromProvider(provider));
                      setProviderEditorExpanded(true);
                    }}
                    style={styles.listRow}
                  >
                    <View style={styles.flex}>
                      <Text style={styles.rowTitle}>{provider.name}</Text>
                      <Text style={styles.help}>
                        {providerLabel(provider.type, t)} ·{' '}
                        {provider.credential.source === 'local_file'
                          ? `Local · ${provider.credential.alias}`
                          : `Database · ${provider.credential.maskedValue ?? t('aiSettings.configured')}`}
                      </Text>
                    </View>
                    <Text style={styles.link}>{t('aiSettings.edit')}</Text>
                  </Pressable>
                ))}
                <Pressable
                  accessibilityLabel={
                    providerEditorExpanded
                      ? t('aiSettings.collapseConnectionForm')
                      : t('aiSettings.addConnection')
                  }
                  accessibilityRole="button"
                  accessibilityState={{ expanded: providerEditorExpanded }}
                  onPress={() => {
                    if (providerEditorExpanded) {
                      setDraft(emptyDraft());
                      setProviderEditorExpanded(false);
                    } else {
                      setDraft(emptyDraft());
                      setProviderEditorExpanded(true);
                    }
                  }}
                  style={styles.disclosure}
                >
                  <Text style={styles.link}>
                    {providerEditorExpanded
                      ? t('aiSettings.collapseConnectionForm')
                      : t('aiSettings.addConnection')}
                  </Text>
                  <Ionicons
                    color={textColors.secondary}
                    name={providerEditorExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                  />
                </Pressable>
                {providerEditorExpanded ? (
                  <ProviderEditor
                    draft={draft}
                    localAliases={overview.localCredentials.credentials}
                    onCancel={() => {
                      setDraft(emptyDraft());
                      setProviderEditorExpanded(false);
                    }}
                    onChange={setDraft}
                    onSave={() => void saveProvider()}
                    secretAllowed={secretAllowed}
                    busy={busy}
                  />
                ) : null}
              </Section>
              <Section title={t('aiSettings.bindings')}>
                <View style={styles.defaultPanel}>
                  <Text style={styles.rowTitle}>{t('aiSettings.defaultBindingsTitle')}</Text>
                  <Text style={styles.help}>{t('aiSettings.defaultBindingsHelp')}</Text>
                  {providerTypes.map((type) => {
                    const providers = overview.providers.filter(
                      (provider) => provider.type === type,
                    );
                    return (
                      <View key={type} style={styles.defaultProviderGroup}>
                        <Text style={styles.fieldLabel}>{providerLabel(type, t)}</Text>
                        {providers.length === 0 ? (
                          <Text style={styles.help}>{t('aiSettings.missingProviderSkip')}</Text>
                        ) : (
                          <ChoiceRow
                            options={providers.map((provider) => ({
                              id: provider.id,
                              label: provider.name,
                            }))}
                            selected={selectedDefaultProvider(type) ?? ''}
                            onSelect={(providerId) =>
                              setDefaultProviderChoices((current) => ({
                                ...current,
                                [type]: providerId,
                              }))
                            }
                          />
                        )}
                      </View>
                    );
                  })}
                  {missingCapabilities.length === 0 ? (
                    <Text style={styles.successText}>{t('aiSettings.defaultsComplete')}</Text>
                  ) : (
                    <ActionButton
                      disabled={busy || defaultTargets.length === 0}
                      label={t('aiSettings.applyDefaults', {
                        count: formatNumber(defaultTargets.length),
                      })}
                      onPress={() => void applyDefaultBindings()}
                    />
                  )}
                  {defaultApplySummary ? (
                    <Text
                      accessibilityLiveRegion="polite"
                      accessibilityRole={
                        defaultApplySummary.failedCapabilities.length > 0 ? 'alert' : undefined
                      }
                      style={
                        defaultApplySummary.failedCapabilities.length > 0
                          ? styles.errorText
                          : styles.successText
                      }
                    >
                      {t('aiSettings.defaultsSummary', {
                        applied: formatNumber(defaultApplySummary.applied),
                        skipped: formatNumber(defaultApplySummary.skipped),
                        failed: formatNumber(defaultApplySummary.failedCapabilities.length),
                      })}
                      {defaultApplySummary.failedCapabilities.length > 0
                        ? ` ${t('aiSettings.defaultsFailures', {
                            capabilities: defaultApplySummary.failedCapabilities
                              .map((capability) => capabilityLabel(capability, t))
                              .join('、'),
                          })}`
                        : ''}
                    </Text>
                  ) : null}
                </View>
                {capabilities.map((capability) => {
                  const current = overview.bindings.find(
                    (item) => item.capability === capability.id,
                  );
                  const provider = overview.providers.find(
                    (item) => item.id === current?.providerConnectionId,
                  );
                  return (
                    <View
                      key={capability.id}
                      style={styles.bindingItem}
                      testID={`capability-item-${capability.id}`}
                    >
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded: bindingCapability === capability.id }}
                        onPress={() => beginBinding(capability.id)}
                        style={styles.listRow}
                        testID={`capability-row-${capability.id}`}
                      >
                        <View style={styles.flex}>
                          <Text style={styles.rowTitle}>{capabilityLabel(capability.id, t)}</Text>
                          <Text style={styles.help}>
                            {provider
                              ? `${provider.name} · ${current?.model}`
                              : t('aiSettings.unconfigured')}
                          </Text>
                        </View>
                        <Text style={styles.link}>{t('aiSettings.configure')}</Text>
                      </Pressable>
                      {bindingCapability === capability.id ? (
                        <View
                          accessibilityLabel={t('aiSettings.bindingEditor', {
                            capability: capabilityLabel(capability.id, t),
                          })}
                          style={styles.editor}
                          testID={`capability-editor-${capability.id}`}
                        >
                          <Text style={styles.rowTitle}>{capabilityLabel(capability.id, t)}</Text>
                          <ChoiceRow
                            options={compatibleProviders.map((item) => ({
                              id: item.id,
                              label: item.name,
                            }))}
                            selected={bindingProviderId}
                            onSelect={(providerConnectionId) => {
                              setBindingProviderId(providerConnectionId);
                              // 换连接后原模型可能不在新供应商目录中，回落到该连接的默认模型。
                              const nextDefault = catalog?.providers.find(
                                (provider) => provider.connectionId === providerConnectionId,
                              )?.defaultModel;
                              if (nextDefault) setBindingModel(nextDefault);
                            }}
                          />
                          <ModelField
                            capability={capability.id}
                            catalogAvailable={
                              catalog?.providers.some(
                                (provider) =>
                                  provider.connectionId === bindingProviderId &&
                                  provider.catalogAvailable,
                              ) ?? true
                            }
                            modelId={bindingModel}
                            modelName={selectedModel?.displayName ?? null}
                            onOpen={openModelPicker}
                          />
                          {supportsThinkingSetting(capability.id) ? (
                            <ChoiceRow
                              options={[
                                { id: 'off', label: t('aiSettings.thinkingOff') },
                                { id: 'on', label: t('aiSettings.thinkingOn') },
                              ]}
                              selected={bindingThinking ? 'on' : 'off'}
                              onSelect={(value) => setBindingThinking(value === 'on')}
                            />
                          ) : null}
                          <ActionButton
                            disabled={busy || !bindingProviderId}
                            label={t('aiSettings.saveBinding')}
                            onPress={() => void saveBinding()}
                          />
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </Section>
              <Section title={t('aiSettings.legacy')}>
                <Text style={styles.help}>
                  {overview.legacy.importedAt
                    ? t('aiSettings.imported', {
                        date: formatDateTime(overview.legacy.importedAt),
                      })
                    : t('aiSettings.legacyStatus', {
                        detected: formatNumber(overview.legacy.detectedVariables.length),
                        missing: formatNumber(overview.legacy.missingVariables.length),
                      })}
                </Text>
                {!overview.legacy.importedAt ? (
                  <ActionButton
                    disabled={busy || !overview.legacy.ready}
                    label={t('aiSettings.importLegacy')}
                    onPress={async () => {
                      if (!token) return;
                      setBusy(true);
                      setError(null);
                      try {
                        setOverview(await settingsApi.importLegacy(token));
                      } catch (reason) {
                        setError(errorMessage(reason, t));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                ) : null}
              </Section>
            </>
          ) : null}
        </View>
        {busy ? <ActivityIndicator color={colors.ink} style={styles.busy} /> : null}
      </ScrollView>
      {bindingCapability ? (
        <ModelPickerSheet
          models={pickerModels}
          onClose={() => setModelPickerOpen(false)}
          onRetry={retryCatalog}
          onSearch={setModelSearch}
          onSelect={(model) => {
            setBindingModel(model.id);
            setModelPickerOpen(false);
          }}
          search={modelSearch}
          selected={bindingModel}
          status={pickerStatus}
          title={capabilityLabel(bindingCapability, t)}
          unavailableReason={catalogError ?? activeCatalog?.unavailableReason ?? null}
          visible={modelPickerOpen}
        />
      ) : null}
      <ActionSheet
        items={[
          {
            disabled: busy,
            icon: 'refresh-outline',
            label: t('aiSettings.refresh'),
            onPress: () => void refreshPage(),
          },
          {
            disabled: !token || busy,
            icon: 'log-out-outline',
            label: t('aiSettings.clearSession'),
            onPress: clearAdminSession,
          },
        ]}
        onClose={() => setActionsVisible(false)}
        title={t('aiSettings.moreActions')}
        visible={actionsVisible}
      />
    </SafeAreaView>
  );
}

function SecurityBanner({
  mode,
  secretAllowed,
}: {
  mode: TransportSecurityMode | null;
  secretAllowed: boolean;
}) {
  const { t } = useAppLanguage();
  const secureLabel =
    mode === 'https'
      ? 'HTTPS'
      : mode === 'localhost'
        ? t('aiSettings.localhost')
        : mode === 'trusted_proxy_https'
          ? t('aiSettings.proxyHttps')
          : mode === null
            ? t('aiSettings.checkingSecurity')
            : t('aiSettings.remoteHttp');
  return (
    <View style={[styles.banner, !secretAllowed && mode !== null && styles.warningBanner]}>
      <Text style={styles.rowTitle}>{t('aiSettings.security', { status: secureLabel })}</Text>
      {!secretAllowed && mode === 'insecure_remote_http' ? (
        <>
          <Text style={styles.warningText}>{t('aiSettings.insecure')}</Text>
          <Text style={styles.help}>{t('aiSettings.nonSecretAllowed')}</Text>
        </>
      ) : (
        <Text style={styles.help}>{t('aiSettings.secretPolicy')}</Text>
      )}
    </View>
  );
}

function LocalProviderCard({ overview }: { overview: SettingsOverview }) {
  const { formatDateTime, t } = useAppLanguage();
  const local = overview.localCredentials;
  return (
    <Section title="Local Credential Provider">
      <Text style={styles.help}>
        {local.configured
          ? local.healthy
            ? t('aiSettings.fileHealthy', {
                date: local.lastLoadedAt ? ` · ${formatDateTime(local.lastLoadedAt)}` : '',
              })
            : t('aiSettings.fileUnhealthy', {
                error: local.error ?? t('aiSettings.unableToLoad'),
              })
          : t('aiSettings.localNotConfigured')}
      </Text>
      {local.credentials.map((item) => (
        <Text key={item.alias} style={styles.aliasText}>
          {item.alias} · {providerLabel(item.type, t)} ·{' '}
          {item.available ? t('aiSettings.available') : t('aiSettings.unavailable')}
        </Text>
      ))}
    </Section>
  );
}

function ProviderEditor({
  draft,
  localAliases,
  onCancel,
  onChange,
  onSave,
  secretAllowed,
  busy,
}: {
  draft: ProviderDraft;
  localAliases: SettingsOverview['localCredentials']['credentials'];
  onCancel: () => void;
  onChange: (value: ProviderDraft) => void;
  onSave: () => void;
  secretAllowed: boolean;
  busy: boolean;
}) {
  const { t } = useAppLanguage();
  const patch = (value: Partial<ProviderDraft>) => onChange({ ...draft, ...value });
  const aliases = localAliases.filter(({ type, available }) => type === draft.type && available);
  return (
    <View style={styles.editor}>
      <Text style={styles.rowTitle}>
        {draft.editingId ? t('aiSettings.editConnection') : t('aiSettings.addConnection')}
      </Text>
      <ChoiceRow
        options={(['dashscope', 'deepseek', 'aliyun_oss'] as const).map((id) => ({
          id,
          label: providerLabel(id, t),
        }))}
        selected={draft.type}
        onSelect={(type) => onChange(switchProviderType(draft, type as ProviderType))}
      />
      <Field
        label={t('aiSettings.name')}
        onChangeText={(name) => patch({ name })}
        value={draft.name}
      />
      {draft.type === 'aliyun_oss' ? (
        <>
          <Field label="Region" onChangeText={(region) => patch({ region })} value={draft.region} />
          <Field label="Bucket" onChangeText={(bucket) => patch({ bucket })} value={draft.bucket} />
        </>
      ) : (
        <>
          <Field
            label={t('aiSettings.publicHttps')}
            onChangeText={(baseUrl) => patch({ baseUrl })}
            value={draft.baseUrl}
          />
          {draft.type === 'dashscope' ? (
            <>
              <Field
                label="Compatible Base URL"
                onChangeText={(compatibleBaseUrl) => patch({ compatibleBaseUrl })}
                value={draft.compatibleBaseUrl}
              />
              <ChoiceRow
                options={[
                  { id: 'polling', label: 'Polling' },
                  { id: 'eventbridge', label: 'EventBridge' },
                ]}
                selected={draft.notifyMode}
                onSelect={(notifyMode) =>
                  patch({ notifyMode: notifyMode as ProviderDraft['notifyMode'] })
                }
              />
              {draft.notifyMode === 'eventbridge' ? (
                <Field
                  label="Callback URL"
                  onChangeText={(callbackUrl) => patch({ callbackUrl })}
                  value={draft.callbackUrl}
                />
              ) : null}
            </>
          ) : null}
        </>
      )}
      <Text style={styles.fieldLabel}>{t('aiSettings.credentialSource')}</Text>
      <ChoiceRow
        options={[
          { id: 'local_file', label: 'Local file' },
          {
            id: 'database',
            label: 'Database',
            disabled: !secretAllowed && draft.credentialSource !== 'database',
          },
        ]}
        selected={draft.credentialSource}
        onSelect={(credentialSource) =>
          patch({ credentialSource: credentialSource as ProviderDraft['credentialSource'] })
        }
      />
      {draft.credentialSource === 'local_file' ? (
        <ChoiceRow
          options={aliases.map(({ alias }) => ({ id: alias, label: alias }))}
          selected={draft.alias}
          onSelect={(alias) => patch({ alias })}
        />
      ) : (
        <>
          <Text style={styles.help}>{t('aiSettings.secretEmpty')}</Text>
          {draft.type === 'aliyun_oss' ? (
            <>
              <Field
                disabled={!secretAllowed}
                label="AccessKey ID"
                onChangeText={(accessKeyId) => patch({ accessKeyId })}
                secureTextEntry
                value={draft.accessKeyId}
              />
              <Field
                disabled={!secretAllowed}
                label="AccessKey Secret"
                onChangeText={(accessKeySecret) => patch({ accessKeySecret })}
                secureTextEntry
                value={draft.accessKeySecret}
              />
            </>
          ) : (
            <>
              <Field
                disabled={!secretAllowed}
                label="API Key"
                onChangeText={(apiKey) => patch({ apiKey })}
                secureTextEntry
                value={draft.apiKey}
              />
              {draft.type === 'dashscope' && draft.notifyMode === 'eventbridge' ? (
                <Field
                  disabled={!secretAllowed}
                  label="Callback Token"
                  onChangeText={(callbackToken) => patch({ callbackToken })}
                  secureTextEntry
                  value={draft.callbackToken}
                />
              ) : null}
            </>
          )}
        </>
      )}
      <ActionButton
        disabled={
          busy || !draft.name.trim() || (draft.credentialSource === 'local_file' && !draft.alias)
        }
        label={draft.editingId ? t('aiSettings.saveChanges') : t('aiSettings.addConnection')}
        onPress={onSave}
      />
      {draft.editingId ? (
        <ActionButton label={t('aiSettings.cancelChanges')} onPress={onCancel} secondary />
      ) : null}
    </View>
  );
}

function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Field({
  disabled = false,
  label,
  style,
  ...input
}: ComponentProps<typeof TextInput> & { label: string; disabled?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled}
        importantForAutofill={disabled ? 'noExcludeDescendants' : 'auto'}
        style={[styles.input, style, disabled && styles.disabled]}
        {...input}
      />
    </View>
  );
}

/** 把价格条目压缩为一行可比较的文本；缺少价格时不展示虚构数值。 */
function priceSummary(model: ProviderModelSummary, t: TranslationFunction): string | null {
  const pricing = model.pricing;
  if (!pricing || pricing.entries.length === 0) return null;
  return pricing.entries
    .slice(0, 4)
    .map((entry) => {
      const unit = pricing.currency === 'CNY' ? '元' : pricing.currency;
      const amount = entry.amount === null ? '—' : `${entry.amount}${unit}`;
      const label =
        entry.type === 'input_token'
          ? t('aiSettings.modelPriceInput')
          : entry.type === 'output_token'
            ? t('aiSettings.modelPriceOutput')
            : entry.type.startsWith('cache')
              ? t('aiSettings.modelPriceCache')
              : (entry.name ?? entry.type);
      return `${label} ${amount}${entry.unit ? `/${entry.unit}` : ''}`;
    })
    .join(' · ');
}
/**
 * 模型选择弹窗。
 *
 * 候选来自服务端按能力责任过滤后的供应商目录；弹窗打开时才读取目录并建立列表，
 * 关闭后立即卸载，避免在配置页常驻渲染整份模型清单。
 */
function ModelPickerSheet({
  models,
  onClose,
  onRetry,
  onSelect,
  search,
  selected,
  status,
  title,
  unavailableReason,
  onSearch,
  visible,
}: {
  models: ProviderModelSummary[];
  onClose: () => void;
  onRetry: () => void;
  onSelect: (model: ProviderModelSummary) => void;
  search: string;
  selected: string;
  status: 'loading' | 'error' | 'unavailable' | 'ready';
  title: string;
  unavailableReason?: string | null;
  onSearch: (value: string) => void;
  visible: boolean;
}) {
  const { t } = useAppLanguage();
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'web' ? undefined : 'padding'}
        style={styles.pickerOverlay}
      >
        <Pressable
          accessibilityLabel={t('common.close')}
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={styles.pickerSheet}>
          <View style={styles.pickerHeader}>
            <Text accessibilityRole="header" numberOfLines={1} style={styles.pickerTitle}>
              {title}
            </Text>
            <Pressable
              accessibilityLabel={t('common.close')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => [styles.pickerClose, pressed && styles.pressed]}
            >
              <Ionicons color={colors.ink} name="close" size={26} />
            </Pressable>
          </View>
          <View style={styles.pickerSearchRow}>
            <View style={styles.pickerInputBox}>
              <Ionicons color={textColors.tertiary} name="search" size={20} />
              <TextInput
                accessibilityLabel={t('aiSettings.searchModel')}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={onSearch}
                placeholder={t('aiSettings.searchModel')}
                placeholderTextColor={textColors.tertiary}
                style={styles.pickerInput}
                value={search}
              />
              {search ? (
                <Pressable
                  accessibilityLabel={t('common.clearSearch')}
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => onSearch('')}
                >
                  <Ionicons color={textColors.secondary} name="close-circle" size={20} />
                </Pressable>
              ) : null}
            </View>
          </View>
          {status === 'loading' ? (
            <View style={styles.pickerState}>
              <ActivityIndicator color={colors.ink} />
              <Text style={styles.help}>{t('aiSettings.catalogLoading')}</Text>
            </View>
          ) : status === 'error' || status === 'unavailable' ? (
            <View style={styles.pickerState}>
              <Text accessibilityRole="alert" style={styles.errorText}>
                {unavailableReason ?? t('aiSettings.catalogUnavailable')}
              </Text>
              <ActionButton label={t('aiSettings.catalogRetry')} onPress={onRetry} />
            </View>
          ) : models.length === 0 ? (
            <View style={styles.pickerState}>
              <Text style={styles.help}>{t('aiSettings.modelNoMatch')}</Text>
            </View>
          ) : (
            <FlatList
              contentContainerStyle={styles.pickerList}
              data={models}
              initialNumToRender={12}
              keyboardShouldPersistTaps="handled"
              keyExtractor={(model) => model.id}
              maxToRenderPerBatch={12}
              renderItem={({ item }) => {
                const prices = priceSummary(item, t);
                const active = selected === item.id;
                return (
                  <Pressable
                    accessibilityLabel={item.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    onPress={() => onSelect(item)}
                    style={[styles.modelRow, active && styles.modelRowSelected]}
                  >
                    <View style={styles.modelRowHead}>
                      <Text style={styles.rowTitle}>
                        {item.displayName}
                        {item.recommended ? ` · ${t('aiSettings.modelRecommended')}` : ''}
                      </Text>
                      {active ? <Ionicons color={colors.ink} name="checkmark" size={22} /> : null}
                    </View>
                    <Text style={styles.help}>{item.id}</Text>
                    {prices ? <Text style={styles.help}>{prices}</Text> : null}
                  </Pressable>
                );
              }}
              windowSize={7}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * 能力绑定面板里的模型字段。
 *
 * 固定能力只展示权威模型；其余能力展示当前选择并用弹窗承载搜索与整份候选清单。
 */
function ModelField({
  capability,
  catalogAvailable,
  modelId,
  modelName,
  onOpen,
}: {
  capability: AiCapability;
  catalogAvailable: boolean;
  modelId: string;
  modelName: string | null;
  onOpen: () => void;
}) {
  const { t } = useAppLanguage();
  const fixed = CAPABILITY_MODEL_REQUIREMENTS[capability].fixedModel;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{t('aiSettings.model')}</Text>
      {fixed ? (
        <>
          <View style={styles.staticValue}>
            <Text style={styles.staticValueText}>{AI_CAPABILITY_DEFAULTS[capability].model}</Text>
          </View>
          <Text style={styles.help}>{t('aiSettings.modelFixedHint')}</Text>
        </>
      ) : (
        <>
          <Pressable
            accessibilityLabel={t('aiSettings.chooseModel')}
            accessibilityRole="button"
            onPress={onOpen}
            style={({ pressed }) => [styles.modelField, pressed && styles.pressed]}
          >
            <View style={styles.flex}>
              <Text numberOfLines={1} style={styles.modelFieldValue}>
                {modelId || t('aiSettings.modelNotSelected')}
              </Text>
              {modelName && modelName !== modelId ? (
                <Text numberOfLines={1} style={styles.help}>
                  {modelName}
                </Text>
              ) : null}
            </View>
            <Text style={styles.link}>{t('aiSettings.chooseModel')}</Text>
          </Pressable>
          {modelId ? null : <Text style={styles.errorText}>{t('aiSettings.modelRequired')}</Text>}
          {catalogAvailable ? null : (
            <Text style={styles.help}>{t('aiSettings.catalogUnavailable')}</Text>
          )}
        </>
      )}
    </View>
  );
}

function ChoiceRow({
  options,
  selected,
  onSelect,
}: {
  options: { id: string; label: string; disabled?: boolean }[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useAppLanguage();
  return (
    <View style={styles.choices}>
      {options.length === 0 ? <Text style={styles.help}>{t('aiSettings.noOptions')}</Text> : null}
      {options.map((option) => (
        <Pressable
          accessibilityLabel={option.label}
          accessibilityRole="radio"
          accessibilityState={{ checked: selected === option.id, disabled: option.disabled }}
          disabled={option.disabled}
          key={option.id}
          onPress={() => onSelect(option.id)}
          style={[
            styles.choice,
            selected === option.id && styles.choiceSelected,
            option.disabled && styles.disabled,
          ]}
        >
          <Text style={styles.choiceText}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function ActionButton({
  disabled = false,
  label,
  onPress,
  secondary = false,
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, secondary && styles.secondaryButton, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.canvas, flex: 1 },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
  flex: { flex: 1 },
  demoPanel: { gap: spacing.md },
  demoNotice: {
    backgroundColor: '#fff1e8',
    borderColor: '#ffd7a8',
    borderRadius: radii.default,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  demoNoticeTitle: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  demoCard: {
    backgroundColor: colors.card,
    borderRadius: radii.default,
    gap: spacing.sm,
    padding: spacing.md,
  },
  demoChoice: {
    borderColor: colors.ink,
    borderRadius: radii.default,
    borderWidth: 1,
    padding: spacing.sm,
  },
  demoApplyButton: {
    alignItems: 'center',
    backgroundColor: colors.black,
    borderRadius: radii.default,
    minHeight: 44,
    justifyContent: 'center',
    padding: spacing.sm,
  },
  demoApplyText: { ...typography.body, color: colors.white, fontFamily: fontFamilies.sansBold },
  banner: {
    backgroundColor: colors.successSurface,
    borderRadius: radii.default,
    gap: spacing.xs,
    padding: spacing.md,
  },
  warningBanner: { backgroundColor: '#fff1e8' },
  warningText: { ...typography.description, color: '#9a3f00', fontFamily: fontFamilies.sans },
  section: {
    backgroundColor: colors.card,
    borderRadius: radii.default,
    gap: spacing.md,
    padding: spacing.md,
  },
  sectionTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  rowTitle: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  help: { ...typography.description, color: textColors.secondary, fontFamily: fontFamilies.sans },
  aliasText: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  errorCard: {
    backgroundColor: '#ffeaea',
    borderRadius: radii.default,
    gap: spacing.sm,
    padding: spacing.md,
  },
  errorText: { ...typography.description, color: colors.danger, fontFamily: fontFamilies.sans },
  listRow: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 56,
    paddingVertical: spacing.sm,
  },
  bindingItem: { gap: spacing.sm },
  disclosure: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
    minHeight: 44,
  },
  link: { ...typography.description, color: '#246bfd', fontFamily: fontFamilies.sansBold },
  defaultPanel: {
    backgroundColor: colors.background,
    borderRadius: radii.default,
    gap: spacing.md,
    padding: spacing.md,
  },
  defaultProviderGroup: { gap: spacing.xs },
  editor: {
    backgroundColor: colors.background,
    borderRadius: radii.default,
    gap: spacing.md,
    padding: spacing.md,
  },
  field: { gap: spacing.xs },
  modelNotice: { gap: spacing.xs },
  modelField: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  modelFieldValue: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  modelRow: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    gap: spacing.xs,
    minHeight: 56,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  modelRowHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  modelRowSelected: { borderColor: colors.ink, borderWidth: 2 },
  pickerOverlay: {
    backgroundColor: 'rgba(16, 24, 40, 0.28)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    alignSelf: 'center',
    backgroundColor: colors.card,
    borderTopLeftRadius: spacing.lg,
    borderTopRightRadius: spacing.lg,
    height: '78%',
    maxWidth: 480,
    width: '100%',
  },
  pickerHeader: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  pickerTitle: {
    ...typography.heading2,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  pickerClose: {
    alignItems: 'center',
    borderRadius: radii.round,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  pickerSearchRow: { padding: spacing.md },
  pickerInputBox: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    height: 48,
    paddingHorizontal: spacing.base,
  },
  pickerInput: {
    ...textInputText,
    ...typography.body,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sans,
    height: 46,
    includeFontPadding: false,
  },
  pickerList: { gap: spacing.sm, paddingBottom: spacing.xl, paddingHorizontal: spacing.md },
  pickerState: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  pressed: { backgroundColor: colors.background, borderRadius: radii.default },
  fieldLabel: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  input: {
    ...textInputText,
    ...typography.body,
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
    height: 44,
    includeFontPadding: false,
    paddingHorizontal: spacing.base,
  },
  staticValue: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.base,
  },
  staticValueText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
    includeFontPadding: false,
  },
  successText: {
    ...typography.description,
    color: colors.success,
    fontFamily: fontFamilies.sans,
  },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  choiceSelected: { borderColor: colors.ink, borderWidth: 2 },
  choiceText: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.black,
    borderRadius: radii.default,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  secondaryButton: { backgroundColor: colors.card, borderColor: colors.divider, borderWidth: 1 },
  buttonText: {
    ...typography.body,
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  secondaryButtonText: { color: textColors.primary },
  disabled: { opacity: 0.4 },
  busy: { marginVertical: spacing.md },
});
