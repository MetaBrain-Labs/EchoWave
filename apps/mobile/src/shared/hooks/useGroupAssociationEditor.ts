/**
 * 分组关联编辑流程。
 *
 * 复用知识库与数据源中加载候选分组、多选、提交和错误恢复的完整交互状态。
 *
 * Responsibilities:
 * - 管理选择器可见性、候选加载和选择集合。
 * - 串行提交关联并在成功后关闭选择器。
 *
 * Notes:
 * - 具体关联 API 与提交后的领域刷新由调用方注入。
 */
import { useCallback, useState } from 'react';

import type { GroupSummary } from '@echowave/contracts';

import { listGroups } from '@/shared/api/groupsApi';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';

type GroupAssociationEditorOptions = {
  linkGroups: (groupIds: string[]) => Promise<void>;
  loadErrorMessage?: string;
  linkErrorMessage?: string;
};

/** 创建资源关联分组所需的共享交互控制器。 */
export function useGroupAssociationEditor({
  linkGroups,
  loadErrorMessage,
  linkErrorMessage,
}: GroupAssociationEditorOptions) {
  const { t } = useAppLanguage();
  const resolvedLoadErrorMessage = loadErrorMessage ?? t('groups.loadFailed');
  const resolvedLinkErrorMessage = linkErrorMessage ?? t('groups.linkFailed');
  const [pickerVisible, setPickerVisible] = useState(false);
  const [availableGroups, setAvailableGroups] = useState<GroupSummary[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(() => new Set());
  const [linking, setLinking] = useState(false);

  const loadAvailableGroups = useCallback(async () => {
    setPickerLoading(true);
    setPickerError('');
    setAvailableGroups([]);
    try {
      setAvailableGroups((await listGroups()).items);
    } catch (reason) {
      setPickerError(reason instanceof Error ? reason.message : resolvedLoadErrorMessage);
    } finally {
      setPickerLoading(false);
    }
  }, [resolvedLoadErrorMessage]);

  const openGroupPicker = useCallback(() => {
    setSelectedGroupIds(new Set());
    setPickerError('');
    setPickerVisible(true);
    void loadAvailableGroups();
  }, [loadAvailableGroups]);

  const toggleGroup = useCallback((groupId: string) => {
    setSelectedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const confirmLinks = useCallback(async () => {
    if (linking || selectedGroupIds.size === 0) return;
    setLinking(true);
    setPickerError('');
    try {
      await linkGroups([...selectedGroupIds]);
      setSelectedGroupIds(new Set());
      setPickerVisible(false);
    } catch (reason) {
      setPickerError(reason instanceof Error ? reason.message : resolvedLinkErrorMessage);
    } finally {
      setLinking(false);
    }
  }, [linkGroups, linking, resolvedLinkErrorMessage, selectedGroupIds]);

  return {
    availableGroups,
    confirmLinks,
    linking,
    loadAvailableGroups,
    openGroupPicker,
    pickerError,
    pickerLoading,
    pickerVisible,
    selectedGroupIds,
    setPickerVisible,
    toggleGroup,
  };
}
