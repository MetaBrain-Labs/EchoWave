/**
 * EchoWave 多引导编排器。
 *
 * 按设备与 Server URL 保存六项引导状态，并跨页面测量、滚动和高亮注册目标。
 *
 * Responsibilities:
 * - 迁移旧基础引导状态并只自动播放一次基础引导。
 * - 注册目标、有限重测并在目标缺失时退化为居中说明。
 * - 提供引导中心所需的开始、重播、完成和跳过能力。
 *
 * Notes:
 * - AsyncStorage 只保存非权威 UI 偏好，引导不会执行业务写入。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { GroupSummary, StarterTemplateKey } from '@echowave/contracts';
import { useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { colors, radii, spacing, textColors, typography } from '@/shared/theme/tokens';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import {
  GUIDE_IDS,
  clampSpotlight,
  localizeGuideRegistry,
  placeTourCard,
  type GuideId,
  type GuideStatus,
  type GuideStep,
  type StarterTourTargetKey,
  type WindowRect,
} from './guideRegistry';
import { StarterTourContext, type StarterTourContextValue } from './StarterTourContext';

export const GUIDE_STORAGE_VERSION = 2;
export const STARTER_TOUR_STORAGE_VERSION = 1;

type TargetRegistration = { node: View; prepare?: () => void };
type GuideStatuses = Record<GuideId, GuideStatus>;

const emptyStatuses = (): GuideStatuses => ({
  basic: 'not_started',
  knowledge: 'not_started',
  data_sources: 'not_started',
  ai_configuration: 'not_started',
  runtime_mode: 'not_started',
  analysis: 'not_started',
});

export function guideStorageKey(serverUrl: string): string {
  return `echowave.guides.v${GUIDE_STORAGE_VERSION}:${serverUrl}`;
}

export function legacyStarterTourStorageKey(serverUrl: string): string {
  return `echowave.starter-tour.v${STARTER_TOUR_STORAGE_VERSION}:${serverUrl}`;
}

function parseStatuses(value: string | null): GuideStatuses | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { statuses?: Partial<GuideStatuses> };
    const next = emptyStatuses();
    for (const id of GUIDE_IDS) {
      const status = parsed.statuses?.[id];
      if (status === 'completed' || status === 'skipped' || status === 'not_started')
        next[id] = status;
    }
    return next;
  } catch {
    return null;
  }
}

/** 在根导航上层维护六项产品引导的设备端生命周期。 */
export function StarterTourProvider({
  children,
  serverUrl,
}: PropsWithChildren<{ serverUrl: string }>) {
  const { t } = useAppLanguage();
  const guideRegistry = useMemo(() => localizeGuideRegistry(t), [t]);
  const router = useRouter();
  const targets = useRef(new Map<StarterTourTargetKey, TargetRegistration>());
  const [targetRevision, setTargetRevision] = useState(0);
  const [templates, setTemplates] = useState<Partial<Record<StarterTemplateKey, string>>>({});
  const [hydrated, setHydrated] = useState(false);
  const [statuses, setStatuses] = useState<GuideStatuses>(emptyStatuses);
  const [activeGuide, setActiveGuide] = useState<GuideId | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<WindowRect | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      AsyncStorage.getItem(guideStorageKey(serverUrl)),
      AsyncStorage.getItem(legacyStarterTourStorageKey(serverUrl)),
    ])
      .then(([current, legacy]) => {
        if (!active) return;
        const restored = parseStatuses(current) ?? emptyStatuses();
        if (!current && legacy === 'completed') restored.basic = 'completed';
        setStatuses(restored);
        setHydrated(true);
        if (!current && legacy === 'completed') {
          void AsyncStorage.setItem(
            guideStorageKey(serverUrl),
            JSON.stringify({ statuses: restored }),
          ).catch(() => undefined);
        }
      })
      .catch(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, [serverUrl]);

  const navigateToStep = useCallback(
    (step: GuideStep, knownTemplates = templates) => {
      const routes: Record<Exclude<GuideStep['route'], 'group' | 'analysis'>, Href> = {
        create: '/(tabs)/create' as Href,
        knowledge: '/(tabs)/knowledge' as Href,
        data_sources: '/(tabs)/sources' as Href,
        ai_configuration: '/settings' as Href,
        runtime_mode: '/audio-runtime' as Href,
      };
      if (step.route === 'group') {
        const groupId = knownTemplates.sales_call_review;
        router.replace(groupId ? ({ pathname: '/', params: { groupId } } as Href) : ('/' as Href));
      } else if (step.route === 'analysis') {
        const groupId = knownTemplates.sales_call_review;
        router.replace(
          groupId
            ? ({ pathname: '/groups/[groupId]/template-example', params: { groupId } } as Href)
            : ('/' as Href),
        );
      } else router.replace(routes[step.route]);
    },
    [router, templates],
  );

  const startGuide = useCallback(
    (id: GuideId) => {
      setRect(null);
      setStepIndex(0);
      setActiveGuide(id);
      navigateToStep(guideRegistry[id].steps[0]);
    },
    [guideRegistry, navigateToStep],
  );

  const offerStarterTemplates = useCallback((groups: readonly GroupSummary[]) => {
    const found: Partial<Record<StarterTemplateKey, string>> = {};
    for (const group of groups)
      if (group.starterTemplateKey) found[group.starterTemplateKey] = group.id;
    setTemplates(found);
  }, []);

  useEffect(() => {
    if (
      hydrated &&
      !activeGuide &&
      statuses.basic === 'not_started' &&
      templates.sales_call_review &&
      templates.personal_speaking_coach
    ) {
      const task = setTimeout(() => startGuide('basic'), 0);
      return () => clearTimeout(task);
    }
    return undefined;
  }, [activeGuide, hydrated, startGuide, statuses.basic, templates]);

  const registerTarget = useCallback(
    (key: StarterTourTargetKey, node: View | null, prepare?: () => void) => {
      const previous = targets.current.get(key);
      if (node) {
        if (previous?.node === node && previous.prepare === prepare) return;
        targets.current.set(key, { node, prepare });
      } else {
        if (!previous) return;
        targets.current.delete(key);
        setRect(null);
      }
      setTargetRevision((current) => current + 1);
    },
    [],
  );

  const definition = activeGuide ? guideRegistry[activeGuide] : null;
  const step = definition?.steps[stepIndex];

  useEffect(() => {
    if (!activeGuide || !step?.target) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const measure = () => {
      if (cancelled) return;
      const registration = targets.current.get(step.target!);
      if (!registration) {
        if (attempt++ < 4) timer = setTimeout(measure, 120);
        return;
      }
      if (attempt === 0) registration.prepare?.();
      registration.node.measureInWindow((x, y, width, height) => {
        if (cancelled) return;
        if (width > 0 && height > 0) setRect({ x, y, width, height });
        else if (attempt++ < 4) timer = setTimeout(measure, 120);
      });
    };
    timer = setTimeout(measure, 40);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeGuide, step?.target, targetRevision]);

  const persistStatus = useCallback(
    (id: GuideId, status: GuideStatus) => {
      setStatuses((current) => {
        const next = { ...current, [id]: status };
        void AsyncStorage.setItem(
          guideStorageKey(serverUrl),
          JSON.stringify({ statuses: next }),
        ).catch(() => undefined);
        return next;
      });
    },
    [serverUrl],
  );

  const finish = useCallback(
    (status: Extract<GuideStatus, 'completed' | 'skipped'>) => {
      if (activeGuide) persistStatus(activeGuide, status);
      setRect(null);
      setActiveGuide(null);
    },
    [activeGuide, persistStatus],
  );

  const move = useCallback(
    (nextIndex: number) => {
      if (!definition) return;
      setRect(null);
      setStepIndex(nextIndex);
      navigateToStep(definition.steps[nextIndex]);
    },
    [definition, navigateToStep],
  );

  const value = useMemo<StarterTourContextValue>(
    () => ({
      activeGuide,
      activeStep: activeGuide ? (step?.target ?? null) : null,
      offerStarterTemplates,
      registerTarget,
      replay: () => startGuide('basic'),
      startGuide,
      statuses,
      templates,
    }),
    [
      activeGuide,
      offerStarterTemplates,
      registerTarget,
      startGuide,
      statuses,
      step?.target,
      templates,
    ],
  );
  const basicGuideSettled =
    hydrated && (statuses.basic !== 'not_started' || activeGuide === 'basic');

  return (
    <StarterTourContext.Provider value={value}>
      <View
        style={styles.provider}
        testID={basicGuideSettled ? 'starter-tour-state-ready' : undefined}
      >
        {children}
      </View>
      {definition && step ? (
        <StarterTourOverlay
          current={stepIndex}
          onClose={() => finish('skipped')}
          onNext={() =>
            stepIndex === definition.steps.length - 1 ? finish('completed') : move(stepIndex + 1)
          }
          onPrevious={stepIndex > 0 ? () => move(stepIndex - 1) : undefined}
          rect={rect}
          step={step}
          stepCount={definition.steps.length}
          visible
        />
      ) : null}
    </StarterTourContext.Provider>
  );
}

function StarterTourOverlay({
  current,
  onClose,
  onNext,
  onPrevious,
  rect,
  step,
  stepCount,
  visible,
}: {
  current: number;
  onClose: () => void;
  onNext: () => void;
  onPrevious?: () => void;
  rect: WindowRect | null;
  step: GuideStep;
  stepCount: number;
  visible: boolean;
}) {
  const { formatNumber, t } = useAppLanguage();
  const { height, width } = useWindowDimensions();
  const cardRef = useRef<View>(null);
  const [cardHeight, setCardHeight] = useState(220);
  const cardWidth = Math.min(360, width - spacing.md * 2);
  const spotlight = rect ? clampSpotlight(rect, width, height) : null;
  const placement = placeTourCard(spotlight, width, height, cardWidth, cardHeight, spacing.md);

  useEffect(() => {
    if (!visible) return;
    const task = setTimeout(() => {
      const handle = findNodeHandle(cardRef.current);
      if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
    }, 100);
    return () => clearTimeout(task);
  }, [current, visible]);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.overlay} testID="starter-tour-overlay">
        {spotlight ? (
          <>
            <View style={[styles.mask, { height: spotlight.top, left: 0, right: 0, top: 0 }]} />
            <View
              style={[
                styles.mask,
                { height: spotlight.height, left: 0, top: spotlight.top, width: spotlight.left },
              ]}
            />
            <View
              style={[
                styles.mask,
                {
                  height: spotlight.height,
                  left: spotlight.left + spotlight.width,
                  right: 0,
                  top: spotlight.top,
                },
              ]}
            />
            <View
              style={[
                styles.mask,
                { bottom: 0, left: 0, right: 0, top: spotlight.top + spotlight.height },
              ]}
            />
            <View pointerEvents="none" style={[styles.spotlight, spotlight]} />
          </>
        ) : (
          <View style={[styles.mask, StyleSheet.absoluteFill]} />
        )}
        <View
          accessibilityLabel={t('tour.stepAccessibility', {
            title: step.title,
            current: formatNumber(current + 1),
            total: formatNumber(stepCount),
          })}
          accessibilityViewIsModal
          onLayout={(event) => setCardHeight(event.nativeEvent.layout.height)}
          ref={cardRef}
          style={[styles.card, { left: placement.left, top: placement.top, width: cardWidth }]}
        >
          {spotlight ? (
            <View
              style={[
                placement.below ? styles.arrowTop : styles.arrowBottom,
                { left: placement.arrowLeft },
              ]}
            />
          ) : null}
          <View style={styles.cardHeader}>
            <Text accessibilityRole="header" style={styles.title}>
              {step.title}
            </Text>
            <Pressable
              accessibilityLabel={t('tour.skip')}
              hitSlop={8}
              onPress={onClose}
              testID="starter-tour-skip"
            >
              <Ionicons color={textColors.secondary} name="close" size={22} />
            </Pressable>
          </View>
          <Text style={styles.body}>{step.body}</Text>
          <View style={styles.footer}>
            <View
              accessibilityLabel={t('tour.progress', {
                current: formatNumber(current + 1),
                total: formatNumber(stepCount),
              })}
              style={styles.dots}
            >
              {Array.from({ length: stepCount }, (_, index) => (
                <View key={index} style={[styles.dot, index === current && styles.dotActive]} />
              ))}
            </View>
            <View style={styles.actions}>
              {onPrevious ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={onPrevious}
                  style={styles.backButton}
                >
                  <Text style={styles.backText}>{t('tour.previous')}</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={onNext}
                style={styles.nextButton}
                testID={current === stepCount - 1 ? 'starter-tour-finish' : 'starter-tour-next'}
              >
                <Text style={styles.nextText}>
                  {current === stepCount - 1 ? t('tour.complete') : t('tour.next')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  provider: { flex: 1 },
  overlay: { flex: 1 },
  mask: { backgroundColor: 'rgba(16, 24, 40, 0.68)', position: 'absolute' },
  spotlight: {
    borderColor: colors.white,
    borderRadius: radii.default,
    borderWidth: 2,
    position: 'absolute',
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.default,
    gap: spacing.base,
    padding: spacing.md,
    position: 'absolute',
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
  },
  arrowTop: {
    borderBottomColor: colors.card,
    borderBottomWidth: 10,
    borderLeftColor: 'transparent',
    borderLeftWidth: 10,
    borderRightColor: 'transparent',
    borderRightWidth: 10,
    height: 0,
    position: 'absolute',
    top: -10,
    width: 0,
  },
  arrowBottom: {
    borderLeftColor: 'transparent',
    borderLeftWidth: 10,
    borderRightColor: 'transparent',
    borderRightWidth: 10,
    borderTopColor: colors.card,
    borderTopWidth: 10,
    bottom: -10,
    height: 0,
    position: 'absolute',
    width: 0,
  },
  cardHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  title: { ...typography.heading2, color: textColors.primary, flex: 1, fontWeight: 'bold' },
  body: { ...typography.body, color: textColors.secondary },
  footer: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  dots: { flex: 1, flexDirection: 'row', gap: 5 },
  dot: { backgroundColor: colors.divider, borderRadius: radii.round, height: 6, width: 6 },
  dotActive: { backgroundColor: colors.ink, width: 16 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  backButton: { justifyContent: 'center', minHeight: 40, paddingHorizontal: spacing.sm },
  backText: { ...typography.description, color: textColors.secondary },
  nextButton: {
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  nextText: { ...typography.description, color: colors.white, fontWeight: 'bold' },
});

export type { GuideId, GuideStatus, StarterTourTargetKey } from './guideRegistry';
export { useStarterTour, useStarterTourTarget } from './StarterTourContext';
