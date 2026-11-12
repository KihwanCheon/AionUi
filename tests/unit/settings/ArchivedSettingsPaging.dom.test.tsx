/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Message } from '@arco-design/web-react';
import { fromApiSidebar, fromApiSidebarItems } from '@/common/adapter/sidebarMapper';
import type { SidebarItem } from '@/common/types/sidebar';
import koSettings from '@/renderer/services/i18n/locales/ko-KR/settings.json';

const { getMock, itemsMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  itemsMock: vi.fn(),
}));

// The component reads `ipcBridge` from `@/common`. Only the sidebar surface is
// exercised here; the mutation endpoints are stubbed so per-row buttons render.
vi.mock('@/common', () => ({
  ipcBridge: {
    sidebar: {
      get: { invoke: getMock },
      items: { invoke: itemsMock },
      unarchive: { invoke: vi.fn(() => Promise.resolve()) },
      deleteArchivedItem: { invoke: vi.fn(() => Promise.resolve()) },
      deleteArchivedProject: { invoke: vi.fn(() => Promise.resolve()) },
    },
  },
}));

// Keep the real `scopeToToken` — the token grammar it produces is exactly what
// the paging assertions verify. Only i18n / logos / passthrough shells are mocked.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'settings.archived.archivedAt') {
        return koSettings.archived.archivedAt.replace('{{date}}', String(opts?.date));
      }
      return opts && 'count' in opts ? `${key}:${String(opts.count)}` : key;
    },
    i18n: { language: 'ko-KR' },
  }),
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({ useAgentLogos: () => ({}) }));

vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: vi.fn() } }));

vi.mock('@/renderer/pages/conversation/utils/conversationAssistantIdentity', () => ({
  resolveConversationLeadingMark: () => ({ kind: 'assistant_fallback' as const }),
}));

vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/pages/settings/components/SettingsPageHeader', () => ({
  default: ({ title, actions }: { title: React.ReactNode; actions?: React.ReactNode }) => (
    <div>
      <div>{title}</div>
      <div>{actions}</div>
    </div>
  ),
}));

import ArchivedSettings from '@/renderer/pages/settings/ArchivedSettings';

const conv = (id: string, name: string): Extract<SidebarItem, { type: 'conversation' }> => ({
  type: 'conversation',
  conversation: {
    id,
    name,
    type: 'acp',
    extra: { backend: 'codex' },
    created_at: 1_700_000_000_000,
    modified_at: 1_700_100_000_000,
  },
});

/** A project group with the given items / paging signals. */
const projectGroup = (
  projectId: string,
  name: string,
  items: ReturnType<typeof conv>[],
  hasMore: boolean,
  nextCursor?: string,
  workspace?: string | null
) => ({
  scope: { type: 'project' as const, project_id: projectId, name, workspace },
  items,
  has_more: hasMore,
  next_cursor: nextCursor,
});

const renderPage = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ArchivedSettings />
    </SWRConfig>
  );

describe('ArchivedSettings paging', () => {
  beforeEach(() => {
    getMock.mockReset();
    itemsMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps the batch deletion settings available when the archive is empty', async () => {
    getMock.mockResolvedValue({ groups: [], has_more_groups: false });
    renderPage();
    const button = await screen.findByRole('button', { name: 'settings.archived.retention.title' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('requests the first screen with an explicit page-size limit and the archived flag', async () => {
    getMock.mockResolvedValue({
      groups: [projectGroup('P1', 'Alpha', [conv('c1', 'Chat One')], false)],
      has_more_groups: false,
    });

    renderPage();

    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(getMock).toHaveBeenCalledWith({ archived: true, limit: 5 });
    // A fully-loaded group (has_more false) shows no "load more" affordance.
    await screen.findByText('Chat One');
    expect(screen.queryByText('settings.archived.loadMore')).toBeNull();
  });

  it.each([false, true])(
    'shows the actual archive dates through the response mapper (next page: %s)',
    async (nextPage) => {
      const conversationAt = Date.parse('2026-10-26T09:10:00Z');
      const teamAt = Date.parse('2026-10-25T03:20:00Z');
      const archivedItems: SidebarItem[] = [
        { ...conv('dated-chat', 'Archived Chat'), archived_at: conversationAt },
        {
          type: 'team',
          team_id: 'dated-team',
          name: 'Archived Team',
          updated_at: 1_700_200_000_000,
          archived_at: teamAt,
          pinned: false,
          member_conversation_ids: [],
        },
      ];
      getMock.mockResolvedValue(
        fromApiSidebar({
          groups: [
            {
              scope: { type: 'chats' },
              items: nextPage ? [conv('earlier-page', 'Earlier Page')] : archivedItems,
              has_more: nextPage,
              next_cursor: nextPage ? 'archive-cursor' : undefined,
            },
          ],
          has_more_groups: false,
        })
      );
      itemsMock.mockResolvedValue(fromApiSidebarItems({ items: archivedItems, has_more: false }));
      renderPage();
      if (nextPage) fireEvent.click(await screen.findByText('settings.archived.loadMore'));
      const formatter = new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      await screen.findByText('Archived Team');
      for (const [name, timestamp] of [
        ['Archived Chat', conversationAt],
        ['Archived Team', teamAt],
      ] as const) {
        expect(screen.getByText(name).parentElement?.textContent).toBe(`${name}보관: ${formatter.format(timestamp)}`);
      }
      expect(getMock).toHaveBeenCalledTimes(1);
      expect(itemsMock).toHaveBeenCalledTimes(nextPage ? 1 : 0);
    }
  );

  it.each([undefined, null, Number.NaN])(
    'does not substitute a creation date for a missing or invalid archive date (%s)',
    async (archivedAt) => {
      getMock.mockResolvedValue(
        fromApiSidebar({
          groups: [
            {
              scope: { type: 'chats' },
              items: [{ ...conv('legacy', 'Legacy Chat'), archived_at: archivedAt }],
              has_more: false,
            },
          ],
          has_more_groups: false,
        })
      );
      renderPage();
      expect((await screen.findByText('Legacy Chat')).parentElement?.textContent).toBe('Legacy Chat');
    }
  );

  it('distinguishes projects with the same name using their parent folders', async () => {
    getMock.mockResolvedValue({
      groups: [
        projectGroup(
          'P1',
          'hdtf-client',
          [conv('c1', 'Chat One')],
          false,
          undefined,
          'file:///C:/Git/Holdem_Fork1/hdtf-client'
        ),
        projectGroup(
          'P2',
          'hdtf-client',
          [conv('c2', 'Chat Two')],
          false,
          undefined,
          'file:///C:/Git/Holdem_Fork3/hdtf-client'
        ),
      ],
      has_more_groups: false,
    });
    renderPage();
    const headings = await screen.findAllByRole('heading', { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      'Holdem_Fork1/hdtf-client',
      'Holdem_Fork3/hdtf-client',
    ]);
  });

  it.each([undefined, null, ''])('keeps the project name when its workspace is %s', async (workspace) => {
    getMock.mockResolvedValue({
      groups: [projectGroup('P1', 'Alpha', [conv('c1', 'Chat One')], false, undefined, workspace)],
      has_more_groups: false,
    });
    renderPage();
    expect((await screen.findByRole('heading', { level: 2 })).textContent).toBe('Alpha');
  });

  it('includes the parent folder for directory groups without a project record', async () => {
    getMock.mockResolvedValue({
      groups: [
        {
          scope: { type: 'dir', key: 'dir1', name: 'hdtf-client', path: 'C:\\Git\\Holdem_Fork2\\hdtf-client' },
          items: [conv('c1', 'Chat One')],
          has_more: false,
        },
      ],
      has_more_groups: false,
    });
    renderPage();
    expect((await screen.findByRole('heading', { level: 2 })).textContent).toBe('Holdem_Fork2/hdtf-client');
  });

  it('renders a load-more button only for a group with more archived items', async () => {
    getMock.mockResolvedValue({
      groups: [projectGroup('P1', 'Alpha', [conv('c1', 'Chat One')], true, 'cursor-1')],
      has_more_groups: false,
    });

    renderPage();

    await screen.findByText('Chat One');
    expect(screen.getByText('settings.archived.loadMore')).toBeTruthy();
  });

  it.each([0, 1, 2])(
    'preserves recent-archive group order when ordinary chats are at position %s',
    async (position) => {
      const groups: Array<
        | ReturnType<typeof projectGroup>
        | {
            scope: { type: 'chats' };
            items: ReturnType<typeof conv>[];
            has_more: boolean;
          }
      > = [
        projectGroup('P2', 'Zulu', [conv('c2', 'Project Two')], false),
        projectGroup('P1', 'Alpha', [conv('c1', 'Project One')], false),
      ];
      groups.splice(position, 0, { scope: { type: 'chats' }, items: [conv('c3', 'Ordinary Chat')], has_more: false });
      getMock.mockResolvedValue({ groups, has_more_groups: false });
      renderPage();
      const expected = ['Zulu', 'Alpha'];
      expected.splice(position, 0, 'settings.archived.noProject');
      const headings = await screen.findAllByRole('heading', { level: 2 });
      expect(headings.map((heading) => heading.textContent)).toEqual(expected);
    }
  );

  it('keeps recent archive rows in place when loading the next window fails', async () => {
    // The app bootstraps Arco's imperative toast adapter outside this component.
    const errorToast = vi.spyOn(Message, 'error').mockReturnValue(vi.fn());
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getMock.mockResolvedValue({
      groups: [
        {
          scope: { type: 'chats' },
          items: [conv('c1', 'Recently Archived')],
          has_more: true,
          next_cursor: 'archive-cursor',
        },
      ],
      has_more_groups: false,
    });
    itemsMock.mockRejectedValue(new Error('unavailable'));
    renderPage();
    fireEvent.click(await screen.findByText('settings.archived.loadMore'));
    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('settings.archived.loadMoreFailed'));
    expect(screen.getByText('Recently Archived')).toBeTruthy();
    expect(itemsMock).toHaveBeenCalledWith({ scope: 'chats', cursor: 'archive-cursor', limit: 10, archived: true });
  });

  it('pages the group via sidebar.items with the derived scope token, appends the window, and clears the button when drained', async () => {
    getMock.mockResolvedValue({
      groups: [projectGroup('P1', 'Alpha', [conv('c1', 'Chat One')], true, 'cursor-1')],
      has_more_groups: false,
    });
    itemsMock.mockResolvedValue({ items: [conv('c2', 'Chat Two')], has_more: false, next_cursor: undefined });

    renderPage();

    fireEvent.click(await screen.findByText('settings.archived.loadMore'));

    await screen.findByText('Chat Two');
    expect(itemsMock).toHaveBeenCalledWith({ scope: 'project:P1', cursor: 'cursor-1', limit: 10, archived: true });
    // Both the first-screen and appended rows are present…
    expect(screen.getByText('Chat One')).toBeTruthy();
    // …and with the group drained, the button is gone.
    await waitFor(() => expect(screen.queryByText('settings.archived.loadMore')).toBeNull());
  });

  it('keeps paging when the appended window still reports more', async () => {
    getMock.mockResolvedValue({
      groups: [projectGroup('P1', 'Alpha', [conv('c1', 'Chat One')], true, 'cursor-1')],
      has_more_groups: false,
    });
    itemsMock.mockResolvedValue({ items: [conv('c2', 'Chat Two')], has_more: true, next_cursor: 'cursor-2' });

    renderPage();

    fireEvent.click(await screen.findByText('settings.archived.loadMore'));

    await screen.findByText('Chat Two');
    // Still more to page: the next click carries the advanced cursor.
    fireEvent.click(screen.getByText('settings.archived.loadMore'));
    await waitFor(() =>
      expect(itemsMock).toHaveBeenLastCalledWith({ scope: 'project:P1', cursor: 'cursor-2', limit: 10, archived: true })
    );
  });
});
