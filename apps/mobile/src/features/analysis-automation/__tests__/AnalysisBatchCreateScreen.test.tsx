/**
 * 一键分析选择器测试。
 *
 * 验证数据源和分组超过四项时的折叠、展开以及隐藏选中项的保留行为。
 */
import type { DataSourceSummary, LinkedDataSourceGroup } from '@echowave/contracts';
import { fireEvent, render } from '@testing-library/react-native';

import { AnalysisBatchCreateScreen } from '../AnalysisBatchCreateScreen';
import {
  listDataSourceAudioFiles,
  listDataSourceGroups,
  listDataSources,
} from '@/shared/api/dataSourcesApi';
import { getAudioRuntime } from '@/shared/api/audioRuntimeApi';
import { listAudioAnalysisBatches } from '@/shared/api/audioAutomationApi';
import { getGroupSettings } from '@/shared/api/groupsApi';

const sources = Array.from(
  { length: 6 },
  (_, index) =>
    ({
      id: `source-${index + 1}`,
      name: `数据源 ${index + 1}`,
      description: '',
      sourceType: 'manual_upload',
      location: 'local',
      connectionLabel: 'test',
      connectionStatus: 'connected',
      linkedGroupCount: 6,
      lastUploadedAt: null,
    }) as DataSourceSummary,
);
const groups = Array.from(
  { length: 6 },
  (_, index) =>
    ({
      id: `group-${index + 1}`,
      name: `分组 ${index + 1}`,
      analysisCount: 0,
      audioCount: 0,
      knowledgeCount: 0,
      sourceCount: 1,
    }) as LinkedDataSourceGroup,
);

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => callback,
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('@/shared/api/audioAutomationApi', () => ({
  createExistingAudioAnalysisBatch: jest.fn(),
  createUploadAnalysisBatch: jest.fn(),
  listAudioAnalysisBatches: jest.fn(),
}));
jest.mock('@/shared/api/audioRuntimeApi', () => ({ getAudioRuntime: jest.fn() }));
jest.mock('@/shared/api/dataSourcesApi', () => ({
  listDataSourceAudioFiles: jest.fn(),
  listDataSourceGroups: jest.fn(),
  listDataSources: jest.fn(),
}));
jest.mock('@/shared/api/groupsApi', () => ({ getGroupSettings: jest.fn() }));
jest.mock('@/shared/onboarding/StarterTourContext', () => ({
  useStarterTourTarget: () => undefined,
}));

describe('AnalysisBatchCreateScreen choice rows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(listDataSources).mockResolvedValue({ items: sources });
    jest.mocked(listDataSourceGroups).mockResolvedValue({ items: groups });
    jest.mocked(listDataSourceAudioFiles).mockResolvedValue({ items: [] });
    jest.mocked(getAudioRuntime).mockResolvedValue({ mode: 'object_storage' } as never);
    jest.mocked(listAudioAnalysisBatches).mockResolvedValue({ items: [] });
    jest.mocked(getGroupSettings).mockResolvedValue({
      analysis: { contentFocus: 'focus', tone: 'tone', customTags: [] },
    } as never);
  });

  it('collapses long source and group lists, then keeps a selected hidden item visible', async () => {
    const screen = render(<AnalysisBatchCreateScreen />);

    expect(await screen.findByText('数据源 1')).toBeTruthy();
    expect(await screen.findByText('分组 1')).toBeTruthy();
    expect(screen.getByText('数据源 4')).toBeTruthy();
    expect(screen.queryByText('数据源 5')).toBeNull();
    expect(screen.queryByText('分组 5')).toBeNull();
    expect(screen.getAllByRole('button', { name: '展开其余 2 项' })).toHaveLength(2);

    const expanders = screen.getAllByRole('button', { name: '展开其余 2 项' });
    fireEvent.press(expanders[1]);
    expect(screen.getByText('分组 6')).toBeTruthy();
    fireEvent.press(screen.getByRole('radio', { name: '分组 6' }));
    fireEvent.press(screen.getByRole('button', { name: '收起' }));

    expect(screen.getByRole('radio', { name: '分组 6' }).props.accessibilityState).toEqual({
      checked: true,
    });
    expect(screen.queryByText('分组 4')).toBeNull();
  });

  it('does not show an expander when all choices fit within four items', async () => {
    jest.mocked(listDataSources).mockResolvedValue({ items: sources.slice(0, 4) });
    jest.mocked(listDataSourceGroups).mockResolvedValue({ items: groups.slice(0, 4) });
    const screen = render(<AnalysisBatchCreateScreen />);

    expect(await screen.findByText('数据源 4')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /展开其余/ })).toBeNull();
  });
});
