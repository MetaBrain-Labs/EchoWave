/**
 * 分组页面自适应排序筛选抽屉。
 *
 * 根据当前标签呈现音频、知识库或数据源对应的排序与筛选项，并以草稿方式等待用户确认。
 *
 * Responsibilities:
 * - 为三类分组资源维护独立筛选草稿。
 * - 支持取消、重置和确认语义。
 *
 * Notes:
 * - 实际列表变换由分组查询模型完成。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import {
  audioStatusLabels,
  connectionStatusLabels,
  dataSourceLocationLabels,
  type AudioSortOrder,
  type AudioStatusKind,
  type DataSourceLocationKind,
  type DataSourceStatusKind,
  type KnowledgeDocumentFilter,
  type ResourceSortOrder,
} from '../model';

type FilterTab = 'audio' | 'knowledge' | 'sources';

/** 三个标签提交给分组页面的排序筛选值。 */
export type GroupFilterValue =
  | { tab: 'audio'; sortOrder: AudioSortOrder; statuses: Set<AudioStatusKind> }
  | {
      tab: 'knowledge';
      sortOrder: ResourceSortOrder;
      documentFilter: KnowledgeDocumentFilter;
    }
  | {
      tab: 'sources';
      sortOrder: ResourceSortOrder;
      locations: Set<DataSourceLocationKind>;
      statuses: Set<DataSourceStatusKind>;
    };

const audioStatusOptions = Object.entries(audioStatusLabels) as [AudioStatusKind, string][];
const locationOptions = Object.entries(dataSourceLocationLabels) as [
  DataSourceLocationKind,
  string,
][];
const connectionOptions = Object.entries(connectionStatusLabels) as [
  DataSourceStatusKind,
  string,
][];

function toggleSetValue<Value>(
  setValue: React.Dispatch<React.SetStateAction<Set<Value>>>,
  value: Value,
) {
  setValue((current) => {
    const next = new Set(current);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  });
}

function SelectionRow({
  checked,
  label,
  onPress,
  role,
}: {
  checked: boolean;
  label: string;
  onPress: () => void;
  role: 'checkbox' | 'radio';
}) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={role === 'radio' ? { selected: checked } : { checked }}
      onPress={onPress}
      style={({ pressed }) => [styles.optionRow, pressed && styles.pressed]}
    >
      <Ionicons
        color={checked ? colors.ink : textColors.tertiary}
        name={
          role === 'radio'
            ? checked
              ? 'radio-button-on'
              : 'radio-button-off'
            : checked
              ? 'checkbox'
              : 'square-outline'
        }
        size={22}
      />
      <Text style={styles.optionText}>{label}</Text>
    </Pressable>
  );
}

/** 渲染当前分组标签对应的排序筛选表单。 */
export function GroupFilterSheet({
  activeTab,
  audioSortOrder,
  audioStatuses,
  knowledgeDocumentFilter,
  knowledgeSortOrder,
  onApply,
  onClose,
  sourceLocations,
  sourceSortOrder,
  sourceStatuses,
  visible,
}: {
  activeTab: FilterTab;
  audioSortOrder: AudioSortOrder;
  audioStatuses: ReadonlySet<AudioStatusKind>;
  knowledgeDocumentFilter: KnowledgeDocumentFilter;
  knowledgeSortOrder: ResourceSortOrder;
  onApply: (value: GroupFilterValue) => void;
  onClose: () => void;
  sourceLocations: ReadonlySet<DataSourceLocationKind>;
  sourceSortOrder: ResourceSortOrder;
  sourceStatuses: ReadonlySet<DataSourceStatusKind>;
  visible: boolean;
}) {
  const [draftAudioSort, setDraftAudioSort] = useState(audioSortOrder);
  const [draftAudioStatuses, setDraftAudioStatuses] = useState(() => new Set(audioStatuses));
  const [draftKnowledgeSort, setDraftKnowledgeSort] = useState(knowledgeSortOrder);
  const [draftDocumentFilter, setDraftDocumentFilter] = useState(knowledgeDocumentFilter);
  const [draftSourceSort, setDraftSourceSort] = useState(sourceSortOrder);
  const [draftLocations, setDraftLocations] = useState(() => new Set(sourceLocations));
  const [draftSourceStatuses, setDraftSourceStatuses] = useState(() => new Set(sourceStatuses));

  const sortLabels =
    activeTab === 'audio'
      ? (['最新创建优先', '最早创建优先'] as const)
      : activeTab === 'knowledge'
        ? (['最近更新优先', '最早更新优先'] as const)
        : (['最近上传优先', '最早上传优先'] as const);
  const currentSort =
    activeTab === 'audio'
      ? draftAudioSort
      : activeTab === 'knowledge'
        ? draftKnowledgeSort
        : draftSourceSort;

  const setSort = (value: ResourceSortOrder) => {
    if (activeTab === 'audio') setDraftAudioSort(value);
    else if (activeTab === 'knowledge') setDraftKnowledgeSort(value);
    else setDraftSourceSort(value);
  };

  const reset = () => {
    if (activeTab === 'audio') {
      setDraftAudioSort('newest');
      setDraftAudioStatuses(new Set());
    } else if (activeTab === 'knowledge') {
      setDraftKnowledgeSort('newest');
      setDraftDocumentFilter('all');
    } else {
      setDraftSourceSort('newest');
      setDraftLocations(new Set());
      setDraftSourceStatuses(new Set());
    }
  };

  const apply = () => {
    if (activeTab === 'audio') {
      onApply({ tab: 'audio', sortOrder: draftAudioSort, statuses: draftAudioStatuses });
    } else if (activeTab === 'knowledge') {
      onApply({
        tab: 'knowledge',
        sortOrder: draftKnowledgeSort,
        documentFilter: draftDocumentFilter,
      });
    } else {
      onApply({
        tab: 'sources',
        sortOrder: draftSourceSort,
        locations: draftLocations,
        statuses: draftSourceStatuses,
      });
    }
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="关闭排序筛选抽屉遮罩"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text accessibilityRole="header" style={styles.title}>
                排序筛选
              </Text>
              <Text style={styles.subtitle}>
                {activeTab === 'sources'
                  ? '从未上传的数据源始终显示在最后'
                  : '未选择筛选项时显示全部'}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="关闭排序筛选抽屉"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <Ionicons color={colors.ink} name="close" size={26} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionTitle}>时间排序</Text>
            {(['newest', 'oldest'] as const).map((value, index) => (
              <SelectionRow
                key={value}
                checked={currentSort === value}
                label={sortLabels[index]}
                onPress={() => setSort(value)}
                role="radio"
              />
            ))}

            {activeTab === 'audio' ? (
              <>
                <Text style={styles.sectionTitle}>处理状态（多选）</Text>
                {audioStatusOptions.map(([value, label]) => (
                  <SelectionRow
                    key={value}
                    checked={draftAudioStatuses.has(value)}
                    label={label}
                    onPress={() => toggleSetValue(setDraftAudioStatuses, value)}
                    role="checkbox"
                  />
                ))}
              </>
            ) : null}

            {activeTab === 'knowledge' ? (
              <>
                <Text style={styles.sectionTitle}>文档状态</Text>
                {(
                  [
                    ['all', '全部知识库'],
                    ['with-documents', '有文档'],
                    ['empty', '空知识库'],
                  ] as const
                ).map(([value, label]) => (
                  <SelectionRow
                    key={value}
                    checked={draftDocumentFilter === value}
                    label={label}
                    onPress={() => setDraftDocumentFilter(value)}
                    role="radio"
                  />
                ))}
              </>
            ) : null}

            {activeTab === 'sources' ? (
              <>
                <Text style={styles.sectionTitle}>存储位置（多选）</Text>
                {locationOptions.map(([value, label]) => (
                  <SelectionRow
                    key={value}
                    checked={draftLocations.has(value)}
                    label={label}
                    onPress={() => toggleSetValue(setDraftLocations, value)}
                    role="checkbox"
                  />
                ))}
                <Text style={styles.sectionTitle}>连接状态（多选）</Text>
                {connectionOptions.map(([value, label]) => (
                  <SelectionRow
                    key={value}
                    checked={draftSourceStatuses.has(value)}
                    label={label}
                    onPress={() => toggleSetValue(setDraftSourceStatuses, value)}
                    role="checkbox"
                  />
                ))}
              </>
            ) : null}
          </ScrollView>
          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              onPress={reset}
              style={({ pressed }) => [styles.resetButton, pressed && styles.pressed]}
            >
              <Text style={styles.resetText}>重置</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="确认排序筛选"
              accessibilityRole="button"
              onPress={apply}
              style={({ pressed }) => [styles.confirmButton, pressed && styles.primaryPressed]}
            >
              <Text style={styles.confirmText}>确认</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { backgroundColor: 'rgba(16, 24, 40, 0.28)', flex: 1, justifyContent: 'flex-end' },
  sheet: {
    alignSelf: 'center',
    backgroundColor: colors.card,
    borderTopLeftRadius: spacing.lg,
    borderTopRightRadius: spacing.lg,
    maxHeight: '82%',
    maxWidth: 480,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  title: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  subtitle: {
    ...typography.label,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.xs,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: radii.round,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  pressed: { backgroundColor: colors.background },
  content: { gap: spacing.xs, padding: spacing.md },
  sectionTitle: {
    ...typography.heading3,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  optionRow: {
    alignItems: 'center',
    borderRadius: radii.default,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  optionText: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sans },
  footer: {
    borderTopColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  resetButton: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  resetText: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  confirmButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: spacing.lg,
  },
  confirmText: {
    ...typography.description,
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  primaryPressed: { opacity: 0.78 },
});
