/**
 * 历史知识引用快照弹层。
 *
 * 展示不可变标题、引文和定位，打开时重新确认来源生命周期。
 *
 * Responsibilities:
 * - 删除和改版后仍可解释历史分析证据。
 * - 仅当前有效版本提供原文跳转。
 *
 * Notes:
 * - 本组件不依赖 feature 内部模块。
 */
import type { BusinessAnalysisCitation } from '@echowave/contracts';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getKnowledgeCitationSource } from '@/shared/api/knowledgeBasesApi';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { colors, radii, spacing, textColors, typography } from '@/shared/theme/tokens';

/** 引用快照的展示接口，同时适配问答和业务分析。 */
export type CitationSnapshot = Omit<BusinessAnalysisCitation, 'knowledgeBaseId'> & {
  knowledgeBaseId?: string;
};
/** 展示快照并阻止已删除或旧版来源跳转当前 chunk。 */
type CitationSnapshotModalProps = {
  citation?: CitationSnapshot;
  onClose: () => void;
  onOpenCurrent?: () => void;
};

/** 每条引用独立校验来源，防止上一次有效状态泄漏至新引用。 */
export function CitationSnapshotModal(props: CitationSnapshotModalProps) {
  return props.citation ? (
    <CitationSnapshotSession
      key={`${props.citation.documentId}:${props.citation.revisionId}:${props.citation.chunkId}`}
      {...props}
    />
  ) : null;
}

/** 打开引用快照后同步外部来源状态。 */
function CitationSnapshotSession({ citation, onClose, onOpenCurrent }: CitationSnapshotModalProps) {
  const { t } = useAppLanguage();
  const [status, setStatus] = useState<'active' | 'superseded' | 'deleted' | 'unavailable'>(
    'unavailable',
  );
  const [loading, setLoading] = useState(Boolean(citation?.revisionId && citation.knowledgeBaseId));
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    if (!citation?.revisionId || !citation.knowledgeBaseId) {
      return;
    }
    void getKnowledgeCitationSource(
      citation.knowledgeBaseId,
      citation.documentId,
      citation.revisionId,
    )
      .then((result) => {
        if (current) setStatus(result.status);
      })
      .catch(() => {
        if (current) setError(t('knowledgeEdit.sourceFailed'));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [citation?.knowledgeBaseId, citation?.documentId, citation?.revisionId, attempt, t]);
  const locator = citation?.locator;
  const location = !locator
    ? ''
    : locator.kind === 'spreadsheet'
      ? t('analysis.locatorRows', {
          sheet: locator.sheet,
          start: locator.rowStart,
          end: locator.rowEnd,
        })
      : locator.kind === 'word'
        ? t('analysis.locatorParagraphs', {
            heading: locator.headingPath.join(' / ') || t('analysis.body'),
            start: locator.paragraphStart,
            end: locator.paragraphEnd,
          })
        : t('analysis.locatorLines', {
            heading: locator.headingPath.join(' / ') || t('analysis.body'),
            start: locator.lineStart,
            end: locator.lineEnd,
          });
  return (
    <Modal transparent visible={Boolean(citation)} onRequestClose={onClose}>
      <View style={styles.overlay} accessibilityViewIsModal>
        <View style={styles.sheet}>
          <Text accessibilityRole="header" style={styles.title}>
            {citation?.documentTitle}
          </Text>
          <Text style={styles.meta}>{location}</Text>
          <Text accessibilityLiveRegion="polite" style={styles.meta}>
            {loading ? t('common.loading') : t(`knowledgeEdit.source.${status}`)}
          </Text>
          <ScrollView style={styles.quoteScroll}>
            <Text selectable style={styles.quote}>
              {citation?.quoteSnapshot || citation?.excerpt || t('knowledgeEdit.noQuote')}
            </Text>
          </ScrollView>
          {error ? (
            <>
              <Text accessibilityRole="alert">{error}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setLoading(true);
                  setError('');
                  setStatus('unavailable');
                  setAttempt((value) => value + 1);
                }}
                style={styles.button}
              >
                <Text>{t('common.retry')}</Text>
              </Pressable>
            </>
          ) : null}
          {status === 'active' && !loading && !error && onOpenCurrent ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onClose();
                onOpenCurrent();
              }}
              style={styles.button}
            >
              <Text>{t('knowledgeEdit.openCurrent')}</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.button}>
            <Text>{t('common.close')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(16,24,40,0.28)',
    padding: spacing.md,
  },
  sheet: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '85%',
    backgroundColor: colors.white,
    borderRadius: radii.default,
    padding: spacing.md,
    gap: spacing.md,
  },
  title: { ...typography.heading2, color: textColors.primary },
  meta: { ...typography.description, color: textColors.secondary },
  quote: { ...typography.body, color: textColors.primary },
  quoteScroll: { flexShrink: 1 },
  button: { padding: spacing.sm, minHeight: 48, justifyContent: 'center' },
});
