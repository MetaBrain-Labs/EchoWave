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
import type {
  AiCapability,
  ProviderConnection,
  ProviderConnectionWrite,
  ProviderType,
  SettingsOverview,
  TransportSecurityMode,
} from '@echowave/contracts';
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

const INSECURE_MESSAGE =
  '当前连接不是 HTTPS，不能通过此页面提交 Credential。请在服务器本地配置 credentials.yaml，然后选择对应的 Local Credential alias。';

const providerLabels: Record<ProviderType, string> = {
  dashscope: 'DashScope',
  deepseek: 'DeepSeek',
  aliyun_oss: '阿里云 OSS',
};

const capabilities: readonly { id: AiCapability; label: string; provider: ProviderType }[] = [
  { id: 'knowledge_embedding', label: '知识嵌入', provider: 'dashscope' },
  { id: 'knowledge_chat', label: '知识问答', provider: 'deepseek' },
  { id: 'audio_transcription', label: '音频转写', provider: 'dashscope' },
  { id: 'audio_emotion', label: '情绪分析', provider: 'dashscope' },
  { id: 'audio_role', label: '角色识别', provider: 'deepseek' },
  { id: 'audio_speaker_review', label: '说话人复核', provider: 'deepseek' },
  { id: 'business_analysis', label: '业务分析', provider: 'deepseek' },
  { id: 'audio_staging', label: '临时 OSS', provider: 'aliyun_oss' },
  { id: 'audio_primary_storage', label: '权威音频对象存储', provider: 'aliyun_oss' },
];

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

const emptyDraft = (): ProviderDraft => ({
  editingId: null,
  type: 'dashscope',
  name: '',
  baseUrl: 'https://dashscope.aliyuncs.com',
  compatibleBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  notifyMode: 'polling',
  callbackUrl: '',
  region: 'oss-cn-beijing',
  bucket: '',
  credentialSource: 'local_file',
  alias: '',
  apiKey: '',
  callbackToken: '',
  accessKeyId: '',
  accessKeySecret: '',
});

function errorMessage(error: unknown): string {
  if (error instanceof WorkspaceRequestError) {
    if (error.code === 'CONFLICT') return `${error.message} 请刷新后重试。`;
    if (error.code === 'UNAUTHORIZED') return '管理员口令无效或已变更。';
    if (error.code === 'INSECURE_CREDENTIAL_TRANSPORT') return INSECURE_MESSAGE;
    return error.message;
  }
  return '配置操作失败，请重试。';
}

function draftFromProvider(provider: ProviderConnection): ProviderDraft {
  const draft = emptyDraft();
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
  const [tokenInput, setTokenInput] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [overview, setOverview] = useState<SettingsOverview | null>(null);
  const [transportMode, setTransportMode] = useState<TransportSecurityMode | null>(null);
  const [secretAllowed, setSecretAllowed] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [bindingCapability, setBindingCapability] = useState<AiCapability | null>(null);
  const [bindingProviderId, setBindingProviderId] = useState('');
  const [bindingModel, setBindingModel] = useState('');
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
      .catch((reason) => setError(errorMessage(reason)));
  }, []);

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
      setError(errorMessage(reason));
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
      setError(errorMessage(reason));
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
      setError(errorMessage(reason));
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
      await refresh(token);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const beginBinding = (capability: AiCapability) => {
    const current = overview?.bindings.find((item) => item.capability === capability);
    setBindingCapability(capability);
    setBindingProviderId(current?.providerConnectionId ?? '');
    setBindingModel(current?.model ?? '');
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
        model: bindingModel.trim(),
        settings:
          bindingCapability === 'knowledge_chat' || bindingCapability === 'business_analysis'
            ? { enableThinking: bindingThinking }
            : {},
        ...(current ? { expectedRevision: current.revision } : {}),
      });
      setBindingCapability(null);
      await refresh(token);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const compatibleProviders = useMemo(() => {
    const required = capabilities.find(({ id }) => id === bindingCapability)?.provider;
    return overview?.providers.filter(({ type }) => type === required) ?? [];
  }, [bindingCapability, overview]);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <PageHeader onBack={onBack} onMore={() => undefined} title="AI 配置" />
      <ScrollView
        alwaysBounceVertical
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<ScreenRefreshControl {...screenRefresh} />}
      >
        <SecurityBanner mode={transportMode} secretAllowed={secretAllowed} />
        {error ? (
          <View accessibilityRole="alert" style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            {token ? <ActionButton label="刷新配置" onPress={() => void refresh()} /> : null}
          </View>
        ) : null}
        {!token ? (
          <Section title="管理员验证">
            <Text style={styles.help}>口令只保存在当前页面内存，离开页面后会清除。</Text>
            <Field
              label="CONFIGURATION_ADMIN_TOKEN"
              onChangeText={setTokenInput}
              secureTextEntry
              value={tokenInput}
            />
            <ActionButton
              disabled={busy || !tokenInput.trim()}
              label="进入配置中心"
              onPress={login}
            />
          </Section>
        ) : overview ? (
          <>
            <LocalProviderCard overview={overview} />
            <Section title="供应商连接">
              {overview.providers.map((provider) => (
                <Pressable
                  accessibilityRole="button"
                  key={provider.id}
                  onPress={() => setDraft(draftFromProvider(provider))}
                  style={styles.listRow}
                >
                  <View style={styles.flex}>
                    <Text style={styles.rowTitle}>{provider.name}</Text>
                    <Text style={styles.help}>
                      {providerLabels[provider.type]} ·{' '}
                      {provider.credential.source === 'local_file'
                        ? `Local · ${provider.credential.alias}`
                        : `Database · ${provider.credential.maskedValue ?? '已配置'}`}
                    </Text>
                  </View>
                  <Text style={styles.link}>修改</Text>
                </Pressable>
              ))}
              <ProviderEditor
                draft={draft}
                localAliases={overview.localCredentials.credentials}
                onChange={setDraft}
                onSave={() => void saveProvider()}
                secretAllowed={secretAllowed}
                busy={busy}
              />
            </Section>
            <Section title="能力绑定">
              {capabilities.map((capability) => {
                const current = overview.bindings.find((item) => item.capability === capability.id);
                const provider = overview.providers.find(
                  (item) => item.id === current?.providerConnectionId,
                );
                return (
                  <Pressable
                    accessibilityRole="button"
                    key={capability.id}
                    onPress={() => beginBinding(capability.id)}
                    style={styles.listRow}
                  >
                    <View style={styles.flex}>
                      <Text style={styles.rowTitle}>{capability.label}</Text>
                      <Text style={styles.help}>
                        {provider ? `${provider.name} · ${current?.model}` : '尚未配置'}
                      </Text>
                    </View>
                    <Text style={styles.link}>设置</Text>
                  </Pressable>
                );
              })}
              {bindingCapability ? (
                <View style={styles.editor}>
                  <Text style={styles.rowTitle}>
                    {capabilities.find(({ id }) => id === bindingCapability)?.label}
                  </Text>
                  <ChoiceRow
                    options={compatibleProviders.map((item) => ({ id: item.id, label: item.name }))}
                    selected={bindingProviderId}
                    onSelect={setBindingProviderId}
                  />
                  <Field label="模型" onChangeText={setBindingModel} value={bindingModel} />
                  {bindingCapability === 'knowledge_chat' ||
                  bindingCapability === 'business_analysis' ? (
                    <ChoiceRow
                      options={[
                        { id: 'off', label: 'Thinking 关闭' },
                        { id: 'on', label: 'Thinking 开启' },
                      ]}
                      selected={bindingThinking ? 'on' : 'off'}
                      onSelect={(value) => setBindingThinking(value === 'on')}
                    />
                  ) : null}
                  <ActionButton
                    disabled={busy || !bindingProviderId || !bindingModel.trim()}
                    label="保存能力绑定"
                    onPress={() => void saveBinding()}
                  />
                </View>
              ) : null}
            </Section>
            <Section title="旧 .env 导入">
              <Text style={styles.help}>
                {overview.legacy.importedAt
                  ? `已导入：${new Date(overview.legacy.importedAt).toLocaleString()}`
                  : `检测到 ${overview.legacy.detectedVariables.length} 项，缺少 ${overview.legacy.missingVariables.length} 项。导入不会覆盖数据库配置。`}
              </Text>
              {!overview.legacy.importedAt ? (
                <ActionButton
                  disabled={busy || !overview.legacy.ready}
                  label="从服务器旧 .env 导入"
                  onPress={async () => {
                    if (!token) return;
                    setBusy(true);
                    setError(null);
                    try {
                      setOverview(await settingsApi.importLegacy(token));
                    } catch (reason) {
                      setError(errorMessage(reason));
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              ) : null}
            </Section>
          </>
        ) : null}
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
  const secureLabel =
    mode === 'https'
      ? 'HTTPS'
      : mode === 'localhost'
        ? '本机连接'
        : mode === 'trusted_proxy_https'
          ? '可信代理 HTTPS'
          : mode === null
            ? '正在检测连接安全性'
            : '远程 HTTP';
  return (
    <View style={[styles.banner, !secretAllowed && mode !== null && styles.warningBanner]}>
      <Text style={styles.rowTitle}>连接安全：{secureLabel}</Text>
      {!secretAllowed && mode === 'insecure_remote_http' ? (
        <>
          <Text style={styles.warningText}>{INSECURE_MESSAGE}</Text>
          <Text style={styles.help}>
            名称、Base URL、模型、Thinking、能力绑定和 Local Credential alias 仍可修改并保存。
          </Text>
        </>
      ) : (
        <Text style={styles.help}>Secret 提交由服务器依据真实 TCP 连接判定。</Text>
      )}
    </View>
  );
}

function LocalProviderCard({ overview }: { overview: SettingsOverview }) {
  const local = overview.localCredentials;
  return (
    <Section title="Local Credential Provider">
      <Text style={styles.help}>
        {local.configured
          ? local.healthy
            ? `文件正常${local.lastLoadedAt ? ` · ${new Date(local.lastLoadedAt).toLocaleString()}` : ''}`
            : `文件异常：${local.error ?? '无法加载'}`
          : 'LOCAL_CREDENTIALS_FILE 尚未配置。'}
      </Text>
      {local.credentials.map((item) => (
        <Text key={item.alias} style={styles.aliasText}>
          {item.alias} · {providerLabels[item.type]} · {item.available ? '可用' : '不可用'}
        </Text>
      ))}
    </Section>
  );
}

function ProviderEditor({
  draft,
  localAliases,
  onChange,
  onSave,
  secretAllowed,
  busy,
}: {
  draft: ProviderDraft;
  localAliases: SettingsOverview['localCredentials']['credentials'];
  onChange: (value: ProviderDraft) => void;
  onSave: () => void;
  secretAllowed: boolean;
  busy: boolean;
}) {
  const patch = (value: Partial<ProviderDraft>) => onChange({ ...draft, ...value });
  const aliases = localAliases.filter(({ type, available }) => type === draft.type && available);
  return (
    <View style={styles.editor}>
      <Text style={styles.rowTitle}>{draft.editingId ? '修改连接' : '添加连接'}</Text>
      <ChoiceRow
        options={Object.entries(providerLabels).map(([id, label]) => ({ id, label }))}
        selected={draft.type}
        onSelect={(type) => patch({ type: type as ProviderType, alias: '' })}
      />
      <Field label="名称" onChangeText={(name) => patch({ name })} value={draft.name} />
      {draft.type === 'aliyun_oss' ? (
        <>
          <Field label="Region" onChangeText={(region) => patch({ region })} value={draft.region} />
          <Field label="Bucket" onChangeText={(bucket) => patch({ bucket })} value={draft.bucket} />
        </>
      ) : (
        <>
          <Field
            label="Base URL（必须为公网 HTTPS）"
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
      <Text style={styles.fieldLabel}>Credential 来源</Text>
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
          <Text style={styles.help}>Secret 留空表示保留当前数据库值。</Text>
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
        label={draft.editingId ? '保存修改' : '添加连接'}
        onPress={onSave}
      />
      {draft.editingId ? (
        <ActionButton label="取消修改" onPress={() => onChange(emptyDraft())} secondary />
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
        style={[styles.input, disabled && styles.disabled]}
        {...input}
      />
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
  return (
    <View style={styles.choices}>
      {options.length === 0 ? <Text style={styles.help}>没有可用选项。</Text> : null}
      {options.map((option) => (
        <Pressable
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
  link: { ...typography.description, color: '#246bfd', fontFamily: fontFamilies.sansBold },
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
    minHeight: 44,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.round,
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
