/**
 * 音频运行模式管理页面。
 *
 * 展示三种租户级运行模式、配置就绪状态和对象生命周期策略，并通过管理员口令保存变更。
 *
 * Responsibilities:
 * - 清楚说明模式切换只影响新上传音频。
 * - 阻止选择服务端判定为不可用的模式。
 * - 处理加载、认证、冲突和网络失败。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { AudioRuntimeMode, AudioRuntimeOverview } from '@echowave/contracts';
import { useEffect, useState } from 'react';
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

import { getAudioRuntime, updateAudioRuntime } from '@/shared/api/audioRuntimeApi';
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

const modeCopy: Record<
  AudioRuntimeMode,
  { title: string; description: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  hybrid: {
    title: '混合存储模式（默认）',
    description: '原音频保存在 API 本地目录，OSS 仅用于模型临时中转。',
    icon: 'git-merge-outline',
  },
  object_storage: {
    title: '对象存储模式',
    description: '原音频直接进入企业 OSS，APP 退出后由服务端继续处理。',
    icon: 'cloud-outline',
  },
  lightweight_local: {
    title: '轻量本地模式',
    description: 'API 仅临时保存音频，ASR 和可选声学情绪完成后自动清理。',
    icon: 'phone-portrait-outline',
  },
};

function errorText(error: unknown): string {
  if (error instanceof WorkspaceRequestError) return error.message;
  return '运行模式操作失败，请稍后重试。';
}

/** 渲染运行模式选择与管理员保存流程。 */
export function AudioRuntimeScreen({ onBack }: { onBack: () => void }) {
  const [overview, setOverview] = useState<AudioRuntimeOverview>();
  const [selected, setSelected] = useState<AudioRuntimeMode>('hybrid');
  const [originalDays, setOriginalDays] = useState('');
  const [intermediateHours, setIntermediateHours] = useState('24');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [baseRevision, setBaseRevision] = useState<number>();

  const applyOverview = (value: AudioRuntimeOverview) => {
    setOverview(value);
    setBaseRevision(value.revision);
    setSelected(value.mode);
    setOriginalDays(value.retention.originalRetentionDays?.toString() ?? '');
    setIntermediateHours(value.retention.intermediateRetentionHours.toString());
    setDirty(false);
  };

  useEffect(() => {
    getAudioRuntime()
      .then(applyOverview)
      .catch((reason) => setError(errorText(reason)))
      .finally(() => setLoading(false));
  }, []);

  const refreshPage = async () => {
    try {
      const value = await getAudioRuntime();
      setOverview(value);
      if (!dirty) {
        applyOverview(value);
      } else if (!value.modes.find((item) => item.mode === selected)?.available) {
        setSelected(value.mode);
      }
      setError(undefined);
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  const screenRefresh = useScreenRefresh(refreshPage);

  const save = async () => {
    if (!overview || !baseRevision || !token.trim()) return;
    setSaving(true);
    setError(undefined);
    try {
      const updated = await updateAudioRuntime(token.trim(), {
        mode: selected,
        expectedRevision: baseRevision,
        retention: {
          originalRetentionDays: originalDays.trim() ? Number(originalDays) : null,
          intermediateRetentionHours: Number(intermediateHours),
        },
      });
      applyOverview(updated);
      setToken('');
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <PageHeader onBack={onBack} onMore={() => undefined} title="运行模式" />
      <ScrollView
        alwaysBounceVertical
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<ScreenRefreshControl {...screenRefresh} />}
        testID="audio-runtime-scroll"
      >
        <View style={styles.notice}>
          <Ionicons color={colors.secondary} name="information-circle-outline" size={22} />
          <Text style={styles.noticeText}>
            模式和期限修改只影响之后上传的音频，不迁移或删除已有资产。
          </Text>
        </View>
        {loading ? <ActivityIndicator color={colors.ink} /> : null}
        {overview
          ? overview.modes.map((availability) => {
              const copy = modeCopy[availability.mode];
              const active = selected === availability.mode;
              return (
                <Pressable
                  accessibilityLabel={copy.title}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active, disabled: !availability.available }}
                  disabled={!availability.available || saving}
                  key={availability.mode}
                  onPress={() => {
                    setSelected(availability.mode);
                    setDirty(true);
                  }}
                  style={[
                    styles.modeCard,
                    active && styles.selectedCard,
                    !availability.available && styles.disabled,
                  ]}
                >
                  <Ionicons color={colors.ink} name={copy.icon} size={24} />
                  <View style={styles.modeCopy}>
                    <Text style={styles.title}>{copy.title}</Text>
                    <Text style={styles.description}>{copy.description}</Text>
                    {!availability.available ? (
                      <Text style={styles.warning}>{availability.unavailableReason}</Text>
                    ) : null}
                  </View>
                  <Ionicons
                    color={colors.ink}
                    name={active ? 'radio-button-on' : 'radio-button-off'}
                    size={22}
                  />
                </Pressable>
              );
            })
          : null}
        {selected === 'object_storage' ? (
          <View style={styles.formCard}>
            <Text style={styles.title}>对象生命周期</Text>
            <Text style={styles.label}>原音频保留天数（留空表示永久）</Text>
            <TextInput
              accessibilityLabel="原音频保留天数"
              inputMode="numeric"
              onChangeText={(value) => {
                setOriginalDays(value);
                setDirty(true);
              }}
              style={styles.input}
              value={originalDays}
            />
            <Text style={styles.label}>中间文件保留小时数（1–168）</Text>
            <TextInput
              accessibilityLabel="中间文件保留小时数"
              inputMode="numeric"
              onChangeText={(value) => {
                setIntermediateHours(value);
                setDirty(true);
              }}
              style={styles.input}
              value={intermediateHours}
            />
          </View>
        ) : null}
        <View style={styles.formCard}>
          <Text style={styles.title}>管理员确认</Text>
          <Text style={styles.description}>保存会改变整个租户的新音频处理策略。</Text>
          <TextInput
            accessibilityLabel="管理员口令"
            onChangeText={setToken}
            placeholder="CONFIGURATION_ADMIN_TOKEN"
            secureTextEntry
            style={styles.input}
            value={token}
          />
          {error ? (
            <Text accessibilityRole="alert" style={styles.warning}>
              {error}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={saving || !overview || !token.trim()}
            onPress={() => void save()}
            style={[styles.saveButton, (saving || !token.trim()) && styles.disabled]}
          >
            <Text style={styles.saveText}>{saving ? '保存中…' : '保存运行模式'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.canvas, flex: 1 },
  content: { gap: spacing.sm, padding: spacing.md, paddingBottom: spacing.xxl },
  notice: {
    alignItems: 'flex-start',
    backgroundColor: colors.background,
    borderRadius: radii.default,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  noticeText: {
    ...typography.description,
    color: textColors.secondary,
    flex: 1,
    fontFamily: fontFamilies.sans,
  },
  modeCard: {
    alignItems: 'flex-start',
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.base,
    padding: spacing.md,
  },
  selectedCard: { borderColor: colors.ink, borderWidth: 2 },
  disabled: { opacity: 0.5 },
  modeCopy: { flex: 1 },
  title: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  description: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.xs,
  },
  warning: {
    ...typography.description,
    color: colors.danger,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.sm,
  },
  formCard: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    padding: spacing.md,
  },
  label: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.xs,
  },
  input: {
    ...typography.body,
    backgroundColor: colors.background,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    color: textColors.primary,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    justifyContent: 'center',
    minHeight: 48,
    marginTop: spacing.sm,
  },
  saveText: {
    ...typography.body,
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
});
