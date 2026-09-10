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
 * - 管理口令和 Secret 只保存在当前组件内存，页面卸载后立即丢失。
 */
import {
  AI_CAPABILITY_DEFAULTS,
  type AiCapability,
  type ProviderConnection,
  type ProviderConnectionWrite,
  type ProviderType,
  type SettingsOverview,
  type TransportSecurityMode,
} from '@echowave/contracts';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
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
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import { useStarterTourTarget } from '@/shared/onboarding/StarterTourContext';

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
    ? 'DashScope'
    : type === 'deepseek'
      ? 'DeepSeek'
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

/** 渲染配置中心并将返回行为交给路由层。 */
export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { formatDateTime, formatNumber, t } = useAppLanguage();
  const securityTourRef = useStarterTourTarget('ai-security');
  const configurationTourRef = useStarterTourTarget('ai-configuration');
  const [tokenInput, setTokenInput] = useState('');
  const [token, setToken] = useState<string | null>(null);
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
  const [bindingThinking, setBindingThinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setToken(null);
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

  const login = async () => {
    const candidate = tokenInput.trim();
    if (!candidate) return;
    setBusy(true);
    setError(null);
    try {
      await settingsApi.verify(candidate);
      setToken(candidate);
      setTokenInput('');
      await refresh(candidate);
    } catch (reason) {
      setError(errorMessage(reason, t));
    } finally {
      setBusy(false);
    }
  };

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
      return;
    }
    const current = overview?.bindings.find((item) => item.capability === capability);
    const compatible =
      overview?.providers.filter(
        ({ type }) => type === AI_CAPABILITY_DEFAULTS[capability].providerType,
      ) ?? [];
    setBindingCapability(capability);
    setBindingProviderId(
      current?.providerConnectionId ?? (compatible.length === 1 ? compatible[0]!.id : ''),
    );
    setBindingThinking(current?.settings.enableThinking === true);
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
        model: AI_CAPABILITY_DEFAULTS[bindingCapability].model,
        settings:
          bindingCapability === 'knowledge_chat' || bindingCapability === 'business_analysis'
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
      ? AI_CAPABILITY_DEFAULTS[bindingCapability].providerType
      : undefined;
    return overview?.providers.filter(({ type }) => type === required) ?? [];
  }, [bindingCapability, overview]);

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
    const providerConnectionId = selectedDefaultProvider(AI_CAPABILITY_DEFAULTS[id].providerType);
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
      <PageHeader onBack={onBack} onMore={() => undefined} title={t('aiSettings.title')} />
      <ScrollView
        alwaysBounceVertical
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<ScreenRefreshControl {...screenRefresh} />}
      >
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
            <Section title={t('aiSettings.adminVerification')}>
              <Text style={styles.help}>{t('aiSettings.tokenMemory')}</Text>
              <Field
                label="CONFIGURATION_ADMIN_TOKEN"
                onChangeText={setTokenInput}
                secureTextEntry
                value={tokenInput}
              />
              <ActionButton
                disabled={busy || !tokenInput.trim()}
                label={t('aiSettings.enter')}
                onPress={login}
              />
            </Section>
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
                            onSelect={setBindingProviderId}
                          />
                          <StaticField
                            label={t('aiSettings.model')}
                            value={AI_CAPABILITY_DEFAULTS[capability.id].model}
                          />
                          {capability.id === 'knowledge_chat' ||
                          capability.id === 'business_analysis' ? (
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

/** 以输入框视觉展示服务端固定模型，避免暗示该值可以自由编辑。 */
function StaticField({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.staticValue}>
        <Text style={styles.staticValueText}>{value}</Text>
      </View>
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
  fieldLabel: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  input: {
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
    paddingVertical: 0,
    textAlignVertical: 'center',
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
