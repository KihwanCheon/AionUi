import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configService } from '@/common/config/configService';
import {
  PROJECT_PINS_CONFIG_KEY,
  setProjectPinned,
  useProjectPins,
} from '@/renderer/pages/conversation/GroupedHistory/ProjectPins';
import { collectProjectGroups } from '@/renderer/pages/conversation/GroupedHistory/ProjectPins/order';
import type { TimelineSection } from '@/renderer/pages/conversation/GroupedHistory/types';

const state = vi.hoisted(() => ({ failSave: false, saved: {} as Record<string, unknown> }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useParams: () => ({}) }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: true }) }));
vi.mock('@/renderer/hooks/context/UserChoiceNotifications', () => ({ ProjectChoiceBadge: () => null }));
vi.mock('@/renderer/pages/cron', () => ({ useCronJobsMap: () => ({ setActiveConversation: vi.fn() }) }));
vi.mock('@/renderer/components/base/AionModal', () => ({ default: () => null }));
vi.mock('@/renderer/pages/conversation/GroupedHistory/ConversationRow', () => ({ default: () => null }));
vi.mock('@/renderer/pages/conversation/GroupedHistory/components/BookmarkedConversationList', () => ({
  default: () => null,
}));
vi.mock('@/renderer/pages/conversation/GroupedHistory/components/MnpUnlinkedConversationsModal', () => ({
  default: () => null,
}));
vi.mock('@/renderer/pages/conversation/GroupedHistory/components/ConversationActivityFilter', () => ({
  default: () => null,
}));
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useProjectGitBranches', () => ({
  useProjectGitBranches: () => ({}),
}));
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationActivityFilter', () => ({
  useConversationActivityFilter: () => ({ enabled: false, filteredConversations: [] }),
}));
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions', () => ({
  useConversationActions: () => ({ renameModalVisible: false, renameModalName: '' }),
}));
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversations', () => ({
  useConversations: () => ({
    conversations: [],
    pinnedConversations: [],
    timelineSections: sections,
    expandedWorkspaces: [],
    historyView: 'all',
    collapsedSections: new Set(),
    isConversationGenerating: () => false,
    hasCompletionUnread: () => false,
    hasFailureUnread: () => false,
  }),
}));

import WorkspaceGroupedHistory from '@/renderer/pages/conversation/GroupedHistory';

const sections: TimelineSection[] = [
  {
    timeline: 'Today',
    items: ['/new', '/middle', '/old'].map((workspace) => ({
      type: 'workspace',
      time: 1,
      workspaceGroup: { workspace, display_name: workspace, conversations: [] },
    })),
  },
];
const Order = () => {
  const { pinnedWorkspaces } = useProjectPins();
  return (
    <output data-testid='order'>
      {collectProjectGroups(sections, pinnedWorkspaces)
        .map((g) => g.workspace)
        .join(',')}
    </output>
  );
};
const mount = () =>
  render(
    <>
      <WorkspaceGroupedHistory />
      <Order />
    </>
  );

beforeEach(async () => {
  state.failSave = false;
  state.saved = {};
  configService.reset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        if (state.failSave) return new Response('failed', { status: 500 });
        Object.assign(state.saved, JSON.parse(init.body as string));
      }
      return new Response(JSON.stringify({ data: state.saved }), { headers: { 'Content-Type': 'application/json' } });
    })
  );
  await configService.initialize();
});
afterEach(() => {
  cleanup();
  configService.reset();
  vi.unstubAllGlobals();
});

describe('persisted project pins', () => {
  it('pins through the real group menu and displays a pin marker', async () => {
    mount();
    fireEvent.click(screen.getAllByLabelText('Project actions')[2]);
    fireEvent.click(await screen.findByText('conversation.history.pinProject'));
    await waitFor(() => expect(screen.getByTestId('order').textContent).toBe('/old,/new,/middle'));
    expect(screen.getByLabelText('conversation.history.projectPinned')).toBeTruthy();
    expect(state.saved[PROJECT_PINS_CONFIG_KEY]).toEqual(['/old']);
  });

  it('serializes rapid pins and appends a repinned project at the end', async () => {
    await Promise.all([setProjectPinned('/old', true), setProjectPinned('/middle', true)]);
    await setProjectPinned('/old', false);
    await setProjectPinned('/old', true);
    expect(state.saved[PROJECT_PINS_CONFIG_KEY]).toEqual(['/middle', '/old']);
    mount();
    expect(screen.getByTestId('order').textContent).toBe('/middle,/old,/new');
  });

  it('restores the saved order after reloading the user preferences', async () => {
    await setProjectPinned('/old', true);
    configService.reset();
    await configService.initialize();
    mount();
    expect(screen.getByTestId('order').textContent).toBe('/old,/new,/middle');
  });

  it('rolls back failed saves and allows the next pin to succeed', async () => {
    await setProjectPinned('/old', true);
    const view = render(<Order />);
    state.failSave = true;
    await act(async () => {
      await expect(setProjectPinned('/middle', true)).rejects.toThrow('failed (500)');
    });
    expect(view.getByTestId('order').textContent).toBe('/old,/new,/middle');
    state.failSave = false;
    await act(async () => {
      await setProjectPinned('/new', true);
    });
    expect(state.saved[PROJECT_PINS_CONFIG_KEY]).toEqual(['/old', '/new']);
  });

  it('unpins from the menu and restores recency order', async () => {
    await setProjectPinned('/old', true);
    mount();
    fireEvent.click(screen.getAllByLabelText('Project actions')[0]);
    fireEvent.click(await screen.findByText('conversation.history.unpinProject'));
    await waitFor(() => expect(screen.getByTestId('order').textContent).toBe('/new,/middle,/old'));
    expect(state.saved[PROJECT_PINS_CONFIG_KEY]).toEqual([]);
  });
});
