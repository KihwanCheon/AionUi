import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';
import { buildGroupedHistory } from '@/renderer/pages/conversation/GroupedHistory/utils/groupingHelpers';

const state = vi.hoisted(() => ({
  running: new Set<string>(),
  collapsedSections: new Set<string>(),
  expandedWorkspaces: [] as string[],
  hiddenIds: new Set<string>(),
}));
const t = (key: string) => key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useParams: () => ({}) }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));
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
  useConversationActivityFilter: (items: TChatConversation[]) => ({
    enabled: state.hiddenIds.size > 0,
    filteredConversations: items.filter((item) => !state.hiddenIds.has(item.id)),
  }),
}));
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions', () => ({
  useConversationActions: () => ({ renameModalVisible: false, renameModalName: '' }),
}));
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversations', () => ({
  useConversations: () => ({
    conversations,
    ...buildGroupedHistory(conversations, t),
    expandedWorkspaces: state.expandedWorkspaces,
    historyView: 'all',
    collapsedSections: state.collapsedSections,
    isConversationGenerating: (id: string) => state.running.has(id),
    isConversationWaitingConfirmation: () => false,
    hasCompletionUnread: () => false,
    hasFailureUnread: () => false,
    getConversationFailure: () => undefined,
    isManualUnread: () => false,
  }),
}));

import WorkspaceGroupedHistory from '@/renderer/pages/conversation/GroupedHistory';

const conversation = (id: string, extra: Record<string, unknown> = {}): TChatConversation =>
  ({ id, name: id, type: 'acp', created_at: 1, modified_at: 1, extra }) as TChatConversation;
const conversations = [
  conversation('project-a', { workspace: '/project-a', custom_workspace: true }),
  conversation('project-b', { workspace: '/project-b', custom_workspace: true }),
  conversation('free-a'),
  conversation('free-b'),
  conversation('archived', { archived: true, workspace: '/project-a', custom_workspace: true }),
  conversation('team-member', { team_id: 'team-1' }),
];
const header = (section: 'projects' | 'conversations') =>
  screen.getByText(`conversation.history.${section}Section`).closest('.sider-section-label') as HTMLElement;
const indicator = (section: 'projects' | 'conversations') =>
  within(header(section)).queryByRole('img', { name: 'common.processing' });

beforeEach(() => {
  state.running.clear();
  state.collapsedSections = new Set(['projects', 'conversations']);
  state.expandedWorkspaces = [];
  state.hiddenIds.clear();
});
afterEach(cleanup);

describe('top-level history activity', () => {
  it('shows three dots for each collapsed section with active descendants', () => {
    state.running = new Set(['project-b', 'free-a']);
    render(<WorkspaceGroupedHistory />);
    expect(indicator('projects')?.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
    expect(indicator('conversations')?.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
  });

  it('keeps activity visible with the project section and nested project expanded', () => {
    state.running.add('project-a');
    state.collapsedSections.clear();
    state.expandedWorkspaces = ['/project-a'];
    render(<WorkspaceGroupedHistory />);
    expect(indicator('projects')).toBeInTheDocument();
    expect(indicator('conversations')).not.toBeInTheDocument();
  });

  it('updates each section independently and waits for its last running descendant', () => {
    state.running = new Set(['project-a', 'project-b', 'free-a']);
    const view = render(<WorkspaceGroupedHistory />);
    state.running.delete('project-a');
    state.running.delete('free-a');
    view.rerender(<WorkspaceGroupedHistory />);
    expect(indicator('projects')).toBeInTheDocument();
    expect(indicator('conversations')).not.toBeInTheDocument();
    state.running.clear();
    view.rerender(<WorkspaceGroupedHistory />);
    expect(indicator('projects')).not.toBeInTheDocument();
  });

  it('does not show activity for archived, team-owned or missing conversations', () => {
    state.running = new Set(['archived', 'team-member', 'missing']);
    render(<WorkspaceGroupedHistory />);
    expect(indicator('projects')).not.toBeInTheDocument();
    expect(indicator('conversations')).not.toBeInTheDocument();
  });

  it('aggregates only descendants included by the current history filter', () => {
    state.running = new Set(['project-b', 'free-b']);
    state.hiddenIds = new Set(['project-b', 'free-b']);
    render(<WorkspaceGroupedHistory />);
    expect(indicator('projects')).not.toBeInTheDocument();
    expect(indicator('conversations')).not.toBeInTheDocument();
  });
});
