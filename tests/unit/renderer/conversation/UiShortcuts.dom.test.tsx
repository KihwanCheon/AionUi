import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import type { IMessageSearchItem, IMessageSearchResponse } from '@/common/types/team/database';
import type { NavigateFunction } from 'react-router-dom';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  pathname: '/conversation/conversation-1',
  desktop: true,
  mac: true,
}));

const conversationPresence = vi.hoisted(() => ({
  activeConversationIds: new Set<string>(),
  hasCompleteConversationList: true,
  refreshConversationListPresence: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync', () => ({
  useConversationListPresence: () => conversationPresence,
}));

const serviceMocks = vi.hoisted(() => ({
  loadMessages: vi.fn(() => new Promise<never>(() => {})),
  searchMessages: vi.fn().mockResolvedValue({ items: [], has_more: false }),
  getConversation: vi.fn().mockResolvedValue(null),
  navigate: vi.fn(),
}));

const clipboardMocks = vi.hoisted(() => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: testState.pathname, search: '', hash: '' }),
  useNavigate: () => serviceMocks.navigate,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { id?: string }) => (params?.id ? `Conversation ID: ${params.id}` : key),
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useVisibleConversationIds', () => ({
  useVisibleConversationIds: () => [],
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => testState.desktop,
  isMacOS: () => testState.mac,
  openExternalUrl: vi.fn(),
}));

vi.mock('@/renderer/utils/ui/clipboard', () => ({
  copyText: clipboardMocks.copyText,
}));

vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  useOptionalPreviewContext: () => null,
}));

vi.mock('@/renderer/utils/chat/messagePagination', () => ({
  loadAllConversationMessagesPaged: serviceMocks.loadMessages,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    database: {
      searchConversationMessages: { invoke: serviceMocks.searchMessages },
    },
  },
}));

vi.mock('@/renderer/components/base/AionModal', () => ({
  default: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? <div role='dialog'>{children}</div> : null,
}));

vi.mock('@/renderer/components/base', () => ({
  AionSearchInput: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input aria-label='global-search-input' value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: serviceMocks.getConversation,
}));
vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({ usePresetAssistantInfo: () => ({ info: null }) }));
vi.mock('@/renderer/components/agent/ThemedLogo', () => ({ default: () => null }));
vi.mock('@/renderer/utils/model/agentLogo', () => ({
  useAgentLogos: () => ({}),
  resolveAgentLogo: () => null,
}));

import { useConversationShortcuts } from '@/renderer/hooks/ui/useConversationShortcuts';
import ConversationSearchPopover from '@/renderer/pages/conversation/GroupedHistory/ConversationSearchPopover';
import SelectionReplyButton from '@/renderer/pages/conversation/Messages/components/SelectionReplyButton';
import { useMinimapPanel } from '@/renderer/pages/conversation/components/ConversationTitleMinimap/useMinimapPanel';
import { useWorkspaceCollapse } from '@/renderer/pages/conversation/hooks/useWorkspaceCollapse';
import { isShortcutBlockedByTarget } from '@/renderer/utils/ui/keyboardShortcuts';
import { dispatchWorkspaceToggleEvent } from '@/renderer/utils/workspace/workspaceEvents';

const idConversation: TChatConversation = {
  id: '9e36690f',
  name: 'Target conversation',
  type: 'acp',
  extra: { backend: 'codex' },
  created_at: 1000,
  modified_at: 2000,
};

const searchMessage = (id = 'message-1', name = 'Target conversation'): IMessageSearchItem => ({
  conversation: { ...idConversation, name },
  message_id: id,
  message_type: 'text',
  message_created_at: 2000,
  preview_text: 'Matched message content',
});

describe('global conversation ID search', () => {
  beforeEach(() => {
    localStorage.clear();
    conversationPresence.activeConversationIds = new Set([idConversation.id]);
    conversationPresence.hasCompleteConversationList = true;
    conversationPresence.refreshConversationListPresence.mockClear();
    serviceMocks.getConversation.mockReset().mockResolvedValue(null);
    serviceMocks.searchMessages.mockReset().mockResolvedValue({ items: [], has_more: false });
    serviceMocks.navigate.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const openSearch = (keyword: string, onConversationSelect = vi.fn(), onSessionClick = vi.fn()) => {
    const view = render(
      <ConversationSearchPopover onConversationSelect={onConversationSelect} onSessionClick={onSessionClick} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'conversation.historySearch.tooltip' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: keyword } });
    return view;
  };

  const pendingSearchBatch = () => {
    let resolve!: (value: IMessageSearchResponse) => void;
    const promise = new Promise<IMessageSearchResponse>((finish) => {
      resolve = finish;
    });
    return { promise, resolve };
  };

  it('publishes recent hits while older ranges are still being searched', async () => {
    const pending = pendingSearchBatch();
    serviceMocks.searchMessages
      .mockResolvedValueOnce({ items: [searchMessage('recent', 'Recent hit')], has_more: true, next_cursor: 'range-1' })
      .mockReturnValueOnce(pending.promise);
    openSearch('needle');
    expect(await screen.findByText('Recent hit')).toBeInTheDocument();
    await waitFor(() =>
      expect(serviceMocks.searchMessages).toHaveBeenLastCalledWith({
        keyword: 'needle',
        cursor: 'range-1',
        page_size: 19,
      })
    );
    await act(async () =>
      pending.resolve({ items: [searchMessage('older', 'Older hit')], has_more: false, next_cursor: null })
    );
    expect(screen.getAllByRole('button', { name: /Recent hit|Older hit/ }).map((button) => button.textContent)).toEqual(
      [expect.stringContaining('Recent hit'), expect.stringContaining('Older hit')]
    );
  });

  it('continues an empty scanned range without announcing an empty search', async () => {
    const pending = pendingSearchBatch();
    serviceMocks.searchMessages
      .mockResolvedValueOnce({ items: [], has_more: true, next_cursor: 'empty-range' })
      .mockReturnValueOnce(pending.promise);
    openSearch('needle');
    await waitFor(() => expect(serviceMocks.searchMessages).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('conversation.historySearch.empty')).not.toBeInTheDocument();
    await act(async () =>
      pending.resolve({ items: [searchMessage('old', 'Old match')], has_more: false, next_cursor: null })
    );
    expect(screen.getByText('Old match')).toBeInTheDocument();
  });

  it('invalidates the old search immediately when typing a different keyword', async () => {
    const old = pendingSearchBatch();
    serviceMocks.searchMessages
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ items: [searchMessage('fresh', 'Fresh hit')], has_more: false, next_cursor: null });
    openSearch('old');
    await waitFor(() => expect(serviceMocks.searchMessages).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new' } });
    await act(async () =>
      old.resolve({ items: [searchMessage('stale', 'Stale hit')], has_more: true, next_cursor: 'stale' })
    );
    expect(screen.queryByText('Stale hit')).not.toBeInTheDocument();
    expect(await screen.findByText('Fresh hit')).toBeInTheDocument();
    expect(serviceMocks.searchMessages).toHaveBeenCalledTimes(2);
  });

  it('stops issuing scan requests when the search dialog is closed', async () => {
    const pending = pendingSearchBatch();
    serviceMocks.searchMessages.mockReturnValueOnce(pending.promise);
    openSearch('needle');
    await waitFor(() => expect(serviceMocks.searchMessages).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await act(async () => {
      pending.resolve({ items: [], has_more: true, next_cursor: 'older' });
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(serviceMocks.searchMessages).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps partial results after failure and retries from the last successful cursor', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    serviceMocks.searchMessages
      .mockResolvedValueOnce({ items: [searchMessage('recent', 'Recent hit')], has_more: true, next_cursor: 'resume' })
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockResolvedValueOnce({
        items: [searchMessage('recent', 'Recent hit'), searchMessage('old', 'Older hit')],
        has_more: false,
        next_cursor: null,
      });
    openSearch('needle');
    await screen.findByRole('alert');
    expect(screen.getByText('Recent hit')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    expect(await screen.findByText('Older hit')).toBeInTheDocument();
    expect(serviceMocks.searchMessages).toHaveBeenLastCalledWith({
      keyword: 'needle',
      cursor: 'resume',
      page_size: 20,
    });
    expect(screen.getAllByText('Recent hit')).toHaveLength(1);
  });

  it('reports a failed first scan instead of claiming there are no matches', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    serviceMocks.searchMessages.mockRejectedValueOnce(new Error('Network failure'));
    openSearch('needle');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('conversation.historySearch.empty')).not.toBeInTheDocument();
  });

  it('stops a repeated cursor instead of requesting the same range indefinitely', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    serviceMocks.searchMessages.mockResolvedValue({ items: [], has_more: true, next_cursor: 'same' });
    openSearch('needle');
    await screen.findByRole('alert');
    expect(serviceMocks.searchMessages).toHaveBeenCalledTimes(2);
  });

  it('pauses after a page of hits and serializes requests for older results', async () => {
    const pending = pendingSearchBatch();
    serviceMocks.searchMessages
      .mockResolvedValueOnce({
        items: Array.from({ length: 20 }, (_, index) => searchMessage(`m-${index}`, `Hit ${index}`)),
        has_more: true,
        next_cursor: 'older',
      })
      .mockReturnValueOnce(pending.promise);
    openSearch('needle');
    const more = await screen.findByRole('button', { name: 'common.more' });
    expect(serviceMocks.searchMessages).toHaveBeenCalledTimes(1);
    fireEvent.click(more);
    fireEvent.click(more);
    await waitFor(() => expect(serviceMocks.searchMessages).toHaveBeenCalledTimes(2));
    await act(async () =>
      pending.resolve({ items: [searchMessage('last', 'Last hit')], has_more: false, next_cursor: null })
    );
    expect(screen.getByText('Last hit')).toBeInTheDocument();
  });

  const openAndSearch = (keyword: string) => {
    const view = render(<ConversationSearchPopover />);
    fireEvent.click(screen.getByRole('button', { name: 'conversation.historySearch.tooltip' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'conversation.historySearch.matchAll' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: keyword } });
    return view;
  };

  it('requires every space-separated term when AND search is checked', async () => {
    serviceMocks.searchMessages.mockResolvedValue({
      items: [{ ...searchMessage('both', 'All terms hit'), preview_text: 'AAAA BBBB CCCC' }],
      has_more: false,
    });
    const { container } = openAndSearch('AAAA CCCC');
    expect(await screen.findByText('All terms hit')).toBeInTheDocument();
    expect(serviceMocks.searchMessages).toHaveBeenCalledWith({
      keyword: 'AAAA CCCC',
      cursor: undefined,
      page_size: 20,
      match_all: true,
    });
    expect(Array.from(container.querySelectorAll('mark'), (mark) => mark.textContent)).toEqual(['AAAA', 'CCCC']);
    expect(localStorage.getItem('conversation.historySearch.matchAll')).toBe('true');
  });

  it('keeps a single AND term and an unchecked phrase as ordinary keyword searches', async () => {
    openAndSearch('needle');
    await waitFor(() =>
      expect(serviceMocks.searchMessages).toHaveBeenCalledWith({ keyword: 'needle', cursor: undefined, page_size: 20 })
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'conversation.historySearch.matchAll' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'AAAA CCCC' } });
    await waitFor(() =>
      expect(serviceMocks.searchMessages).toHaveBeenLastCalledWith({
        keyword: 'AAAA CCCC',
        cursor: undefined,
        page_size: 20,
      })
    );
    expect(localStorage.getItem('conversation.historySearch.matchAll')).toBe('false');
  });

  it('restores the AND search choice and reruns the open search when it changes', async () => {
    localStorage.setItem('conversation.historySearch.matchAll', 'true');
    render(<ConversationSearchPopover />);
    fireEvent.click(screen.getByRole('button', { name: 'conversation.historySearch.tooltip' }));
    const checkbox = screen.getByRole('checkbox', { name: 'conversation.historySearch.matchAll' });
    expect(checkbox).toBeChecked();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'AAAA CCCC' } });
    await waitFor(() =>
      expect(serviceMocks.searchMessages).toHaveBeenLastCalledWith(expect.objectContaining({ match_all: true }))
    );
    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(serviceMocks.searchMessages).toHaveBeenLastCalledWith({
        keyword: 'AAAA CCCC',
        cursor: undefined,
        page_size: 20,
      })
    );
  });

  it('shows the same parent/folder project label as the sidebar for an active ID result', async () => {
    serviceMocks.getConversation.mockResolvedValue({
      ...idConversation,
      project_id: 'project-1',
      extra: { backend: 'codex', workspace: 'C:\\Git\\ProjectAlpha\\client', custom_workspace: true },
    });
    openSearch(idConversation.id);
    expect(await screen.findByText('conversation.historySearch.locationProject')).toBeInTheDocument();
    expect(screen.getByTitle('C:\\Git\\ProjectAlpha\\client')).toHaveTextContent('ProjectAlpha/client');
    expect(screen.getByTitle('C:\\Git\\ProjectAlpha\\client')).not.toHaveTextContent('C:\\Git');
  });

  it('refreshes the shared active feed once on open, without fetching again for each search', async () => {
    serviceMocks.getConversation.mockResolvedValue(idConversation);
    openSearch(idConversation.id);
    await screen.findByRole('button', { name: /Target conversation/ });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Matched' } });
    await waitFor(() =>
      expect(serviceMocks.searchMessages).toHaveBeenLastCalledWith({
        keyword: 'Matched',
        cursor: undefined,
        page_size: 20,
      })
    );
    expect(conversationPresence.refreshConversationListPresence).toHaveBeenCalledTimes(1);
  });

  it('shows archived for an ID absent from the complete active list even when its old project is retained', async () => {
    conversationPresence.activeConversationIds = new Set();
    serviceMocks.getConversation.mockResolvedValue({ ...idConversation, project_id: 'project-1' });
    openSearch(idConversation.id);
    expect(await screen.findByText('conversation.historySearch.locationArchived')).toBeInTheDocument();
    expect(screen.queryByText('conversation.historySearch.locationProject')).not.toBeInTheDocument();
  });

  it('shows the ordinary chat location for message search results', async () => {
    serviceMocks.searchMessages.mockResolvedValue({ items: [searchMessage()], has_more: false });
    openSearch('Matched');
    expect(await screen.findByText('conversation.historySearch.locationChats')).toBeInTheDocument();
  });

  it('keeps temporary conversations out of the project location even when a project ID exists', async () => {
    serviceMocks.getConversation.mockResolvedValue({
      ...idConversation,
      project_id: 'temporary-project',
      extra: { backend: 'codex', workspace: 'C:\\Sessions\\temporary', is_temporary_workspace: true },
    });
    openSearch(idConversation.id);
    expect(await screen.findByText('conversation.historySearch.locationChats')).toBeInTheDocument();
    expect(screen.queryByText('conversation.historySearch.locationProject')).not.toBeInTheDocument();
  });

  it('keeps location unknown when the active list is loading, partial or unavailable', async () => {
    conversationPresence.activeConversationIds = new Set();
    conversationPresence.hasCompleteConversationList = false;
    serviceMocks.getConversation.mockResolvedValue(idConversation);
    openSearch(idConversation.id);
    await screen.findByRole('button', { name: /Target conversation/ });
    expect(screen.queryByText('conversation.historySearch.locationArchived')).not.toBeInTheDocument();
    expect(screen.queryByText('conversation.historySearch.locationChats')).not.toBeInTheDocument();
  });

  it('updates the location when a conversation moves from the active list to the archive', async () => {
    serviceMocks.getConversation.mockResolvedValue(idConversation);
    const view = openSearch(idConversation.id);
    await screen.findByText('conversation.historySearch.locationChats');
    conversationPresence.activeConversationIds = new Set();
    view.rerender(<ConversationSearchPopover />);
    expect(screen.getByText('conversation.historySearch.locationArchived')).toBeInTheDocument();
  });

  it('finds a conversation with no messages by its ID and navigates without a message anchor', async () => {
    serviceMocks.getConversation.mockResolvedValue(idConversation);
    const onSelect = vi.fn();
    const onSessionClick = vi.fn();
    openSearch('  9E36690F  ', onSelect, onSessionClick);
    const result = await screen.findByRole('button', { name: /Target conversation/ });
    expect(serviceMocks.getConversation).toHaveBeenCalledWith('9e36690f');
    await act(async () => {
      fireEvent.click(result);
    });
    expect(serviceMocks.navigate).toHaveBeenCalledWith('/conversation/9e36690f', {
      state: { fromConversationSearch: true },
    });
    expect([
      onSelect.mock.calls.length,
      onSessionClick.mock.calls.length,
      screen.queryAllByRole('dialog').length,
    ]).toEqual([1, 1, 0]);
  });

  it('keeps message hits below the ID hit and preserves navigation to a matched message', async () => {
    serviceMocks.getConversation.mockResolvedValue(idConversation);
    serviceMocks.searchMessages.mockResolvedValue({ items: [searchMessage()], has_more: false });
    openSearch('9e36690f');
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Target conversation/ })).toHaveLength(2));
    const results = screen.getAllByRole('button', { name: /Target conversation/ });
    expect(results[0]).toHaveTextContent('Conversation ID: 9e36690f');
    await act(async () => {
      fireEvent.click(results[1]);
    });
    expect(serviceMocks.navigate).toHaveBeenCalledWith('/conversation/9e36690f', {
      state: { targetMessageId: 'message-1', fromConversationSearch: true },
    });
  });

  it('keeps the ID hit when message search fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    serviceMocks.getConversation.mockResolvedValue(idConversation);
    serviceMocks.searchMessages.mockRejectedValue(new Error('message search unavailable'));
    openSearch('9e36690f');
    expect(await screen.findByRole('button', { name: /Target conversation/ })).toBeInTheDocument();
  });

  it('keeps message results when the ID does not exist or is not visible to the user', async () => {
    serviceMocks.searchMessages.mockResolvedValue({ items: [searchMessage()], has_more: false });
    openSearch('9e36690f');
    expect(await screen.findByRole('button', { name: /Target conversation/ })).toHaveTextContent(
      'Matched message content'
    );
    expect(screen.queryByText(/Conversation ID:/)).not.toBeInTheDocument();
  });

  it('keeps message results when the ID lookup fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    serviceMocks.getConversation.mockRejectedValue(new Error('lookup unavailable'));
    serviceMocks.searchMessages.mockResolvedValue({ items: [searchMessage()], has_more: false });
    openSearch('9e36690f');
    expect(await screen.findByRole('button', { name: /Target conversation/ })).toHaveTextContent(
      'Matched message content'
    );
  });

  it('ignores an ID lookup that completes after a newer search', async () => {
    let resolveOld!: (conversation: TChatConversation) => void;
    serviceMocks.getConversation.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      })
    );
    serviceMocks.getConversation.mockResolvedValue({ ...idConversation, id: '12345678', name: 'New conversation' });
    openSearch('9e36690f');
    await waitFor(() => expect(serviceMocks.getConversation).toHaveBeenCalledWith('9e36690f'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '12345678' } });
    await screen.findByRole('button', { name: /New conversation/ });
    await act(async () => {
      resolveOld(idConversation);
    });
    expect(screen.queryByRole('button', { name: /Target conversation/ })).not.toBeInTheDocument();
  });

  it('ignores a message search that finishes after the ID query has changed', async () => {
    let resolveOld!: (result: { items: IMessageSearchItem[]; has_more: boolean }) => void;
    serviceMocks.searchMessages.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      })
    );
    openSearch('previous query');
    await waitFor(() => expect(serviceMocks.searchMessages).toHaveBeenCalled());
    serviceMocks.getConversation.mockResolvedValue(idConversation);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '9e36690f' } });
    await screen.findByRole('button', { name: /Target conversation/ });
    await act(async () => {
      resolveOld({ items: [searchMessage('old-message', 'Old conversation')], has_more: false });
    });
    expect(screen.queryByRole('button', { name: /Old conversation/ })).not.toBeInTheDocument();
  });

  it.each(['한국어 검색', '9e36', 'conversations/9e36690f', '9e36690f?query=value'])(
    'keeps %s as a content query without treating it as an ID',
    async (keyword) => {
      openSearch(keyword);
      await waitFor(() =>
        expect(serviceMocks.searchMessages).toHaveBeenCalledWith({ keyword, cursor: undefined, page_size: 20 })
      );
      expect(serviceMocks.getConversation).not.toHaveBeenCalled();
    }
  );

  it('loads the next message page without duplicating the conversation result', async () => {
    serviceMocks.getConversation.mockResolvedValue(idConversation);
    serviceMocks.searchMessages.mockResolvedValueOnce({
      items: Array.from({ length: 20 }, (_, index) => searchMessage(`message-${index}`)),
      has_more: true,
      next_cursor: 'next-page',
    });
    serviceMocks.searchMessages.mockResolvedValueOnce({
      items: [searchMessage('message-20')],
      has_more: false,
      next_cursor: null,
    });
    openSearch('9e36690f');
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Target conversation/ })).toHaveLength(21));
    const result = screen.getAllByRole('button', { name: /Target conversation/ })[0];
    fireEvent.scroll(result.parentElement!.parentElement!);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Target conversation/ })).toHaveLength(22));
    expect(serviceMocks.searchMessages).toHaveBeenLastCalledWith({
      keyword: '9e36690f',
      cursor: 'next-page',
      page_size: 20,
    });
    expect(serviceMocks.getConversation).toHaveBeenCalledTimes(1);
  });
});

const dispatchShortcut = (target: EventTarget, init: KeyboardEventInit): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

const renderConversationShortcuts = ({
  navigate = vi.fn(),
  toggleSider = vi.fn(),
}: {
  navigate?: ReturnType<typeof vi.fn>;
  toggleSider?: ReturnType<typeof vi.fn>;
} = {}) => {
  const rendered = renderHook(() =>
    useConversationShortcuts({
      navigate: navigate as unknown as NavigateFunction,
      toggleSider,
    })
  );

  return { ...rendered, navigate, toggleSider };
};

describe('common desktop UI shortcuts', () => {
  beforeEach(() => {
    testState.pathname = '/conversation/conversation-1';
    testState.desktop = true;
    testState.mac = true;
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('uses Cmd+B and leaves Ctrl+B untouched on macOS', () => {
    const { toggleSider } = renderConversationShortcuts();

    const commandEvent = dispatchShortcut(window, { key: 'b', metaKey: true });
    const controlEvent = dispatchShortcut(window, { key: 'b', ctrlKey: true });

    expect(toggleSider).toHaveBeenCalledTimes(1);
    expect(commandEvent.defaultPrevented).toBe(true);
    expect(controlEvent.defaultPrevented).toBe(false);
  });

  it('uses Ctrl+B and leaves Cmd+B untouched on non-macOS platforms', () => {
    testState.mac = false;
    const { toggleSider } = renderConversationShortcuts();

    const controlEvent = dispatchShortcut(window, { key: 'b', ctrlKey: true });
    const commandEvent = dispatchShortcut(window, { key: 'b', metaKey: true });

    expect(toggleSider).toHaveBeenCalledTimes(1);
    expect(controlEvent.defaultPrevented).toBe(true);
    expect(commandEvent.defaultPrevented).toBe(false);
  });

  it('toggles the sidebar while the composer textarea is focused', () => {
    const composer = document.createElement('textarea');
    document.body.appendChild(composer);
    composer.focus();
    const { toggleSider } = renderConversationShortcuts();

    const event = dispatchShortcut(composer, { key: 'b', metaKey: true });

    expect(toggleSider).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('keeps the existing new-conversation shortcut isolated from common UI actions', () => {
    const { navigate, toggleSider } = renderConversationShortcuts();

    const event = dispatchShortcut(window, { key: 't', metaKey: true });

    expect(navigate).toHaveBeenCalledWith('/guid');
    expect(toggleSider).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves Ctrl+T untouched on macOS', () => {
    const { navigate } = renderConversationShortcuts();

    const event = dispatchShortcut(window, { key: 't', ctrlKey: true });

    expect(navigate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('keeps Ctrl+Tab as a cross-platform conversation cycling chord', () => {
    const { navigate } = renderConversationShortcuts();

    const event = dispatchShortcut(window, { key: 'Tab', ctrlKey: true });

    expect(navigate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('uses the enabled workspace consumer and preserves its collapse state owner', () => {
    const { result } = renderHook(() => {
      const workspace = useWorkspaceCollapse({
        workspaceEnabled: true,
        isMobile: false,
        conversation_id: 'conversation-1',
      });
      useConversationShortcuts({
        navigate: vi.fn() as unknown as NavigateFunction,
        toggleSider: vi.fn(),
      });
      return workspace;
    });

    const event = dispatchShortcut(window, { key: 'l', metaKey: true });

    expect(result.current.rightSiderCollapsed).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves Cmd/Ctrl+L untouched when the conversation has no enabled workspace', () => {
    const { result } = renderHook(() => {
      const workspace = useWorkspaceCollapse({
        workspaceEnabled: false,
        isMobile: false,
        conversation_id: 'conversation-1',
      });
      useConversationShortcuts({
        navigate: vi.fn() as unknown as NavigateFunction,
        toggleSider: vi.fn(),
      });
      return workspace;
    });

    const event = dispatchShortcut(window, { key: 'l', metaKey: true });

    expect(result.current.rightSiderCollapsed).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it('toggles a temporary workspace while its composer textarea is focused', () => {
    testState.pathname = '/guid';
    const composer = document.createElement('textarea');
    document.body.appendChild(composer);
    composer.focus();
    const { result } = renderHook(() => {
      const workspace = useWorkspaceCollapse({
        workspaceEnabled: true,
        isMobile: false,
        conversation_id: 'temporary-conversation',
        isTemporaryWorkspace: true,
      });
      useConversationShortcuts({
        navigate: vi.fn() as unknown as NavigateFunction,
        toggleSider: vi.fn(),
      });
      return workspace;
    });

    const event = dispatchShortcut(composer, { key: 'l', metaKey: true });

    expect(result.current.rightSiderCollapsed).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves workspace shortcuts to embedded code editors', () => {
    const editor = document.createElement('div');
    editor.className = 'cm-editor';
    document.body.appendChild(editor);
    const { result } = renderHook(() => {
      const workspace = useWorkspaceCollapse({
        workspaceEnabled: true,
        isMobile: false,
        conversation_id: 'conversation-1',
      });
      useConversationShortcuts({
        navigate: vi.fn() as unknown as NavigateFunction,
        toggleSider: vi.fn(),
      });
      return workspace;
    });

    const event = dispatchShortcut(editor, { key: 'l', metaKey: true });

    expect(result.current.rightSiderCollapsed).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores chords with wrong modifiers or unsafe keyboard state', () => {
    const { toggleSider } = renderConversationShortcuts();
    const ineligibleEvents: KeyboardEventInit[] = [
      { key: 'b' },
      { key: 'b', ctrlKey: true, metaKey: true },
      { key: 'b', metaKey: true, altKey: true },
      { key: 'b', metaKey: true, shiftKey: true },
      { key: 'b', metaKey: true, repeat: true },
      { key: 'b', metaKey: true, isComposing: true },
    ];

    for (const init of ineligibleEvents) {
      dispatchShortcut(window, init);
    }
    const preventedEvent = new KeyboardEvent('keydown', {
      key: 'b',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    preventedEvent.preventDefault();
    act(() => window.dispatchEvent(preventedEvent));

    expect(toggleSider).not.toHaveBeenCalled();
  });

  it('leaves sidebar shortcuts to embedded code editors, terminals, and frames', () => {
    const { toggleSider } = renderConversationShortcuts();
    const targets = [
      Object.assign(document.createElement('div'), { className: 'cm-editor' }),
      Object.assign(document.createElement('div'), { className: 'monaco-editor' }),
      Object.assign(document.createElement('div'), { className: 'xterm' }),
      document.createElement('webview'),
      document.createElement('iframe'),
    ];

    const events = targets.map((target) => {
      document.body.appendChild(target);
      return dispatchShortcut(target, { key: 'b', metaKey: true });
    });

    expect(toggleSider).not.toHaveBeenCalled();
    expect(events.every((event) => !event.defaultPrevented)).toBe(true);
  });

  it('handles text and SVG event targets without assuming HTMLElement APIs', () => {
    const { toggleSider } = renderConversationShortcuts();
    const wrapper = document.createElement('div');
    const textTarget = document.createTextNode('label');
    const svgTarget = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    wrapper.append(textTarget, svgTarget);
    document.body.appendChild(wrapper);

    dispatchShortcut(textTarget, { key: 'b', metaKey: true });
    dispatchShortcut(svgTarget, { key: 'b', metaKey: true });

    expect(toggleSider).toHaveBeenCalledTimes(2);
  });

  it('falls back to the event target when composedPath is unavailable', () => {
    const input = document.createElement('input');
    const event = {
      composedPath: undefined,
      target: input,
    } as unknown as KeyboardEvent;

    expect(isShortcutBlockedByTarget(event)).toBe(true);
  });

  it('reports an unhandled workspace toggle when no window global is available', () => {
    vi.stubGlobal('window', undefined);

    try {
      expect(dispatchWorkspaceToggleEvent()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('yields when an embedded surface owns focus after event retargeting', () => {
    const { toggleSider } = renderConversationShortcuts();
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    frame.focus();

    const event = dispatchShortcut(window, { key: 'b', metaKey: true });

    expect(document.activeElement).toBe(frame);
    expect(toggleSider).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('checks focused element ancestors when an editor event is retargeted', () => {
    const { toggleSider } = renderConversationShortcuts();
    const editor = document.createElement('div');
    editor.className = 'monaco-editor';
    const editorControl = document.createElement('div');
    editorControl.tabIndex = 0;
    editor.appendChild(editorControl);
    document.body.appendChild(editor);
    editorControl.focus();

    const event = dispatchShortcut(window, { key: 'b', metaKey: true });

    expect(document.activeElement).toBe(editorControl);
    expect(toggleSider).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('keeps browser shortcuts intact in WebUI', () => {
    testState.desktop = false;
    const { toggleSider } = renderConversationShortcuts();

    const event = dispatchShortcut(window, { key: 'b', metaKey: true });

    expect(toggleSider).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('removes its listener on unmount', () => {
    const { toggleSider, unmount } = renderConversationShortcuts();
    unmount();

    const event = dispatchShortcut(window, { key: 'b', metaKey: true });

    expect(toggleSider).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('rebinds without retaining a stale listener after dependencies change', () => {
    const firstToggle = vi.fn();
    const secondToggle = vi.fn();
    const navigate = vi.fn() as unknown as NavigateFunction;
    const { rerender } = renderHook(({ toggleSider }) => useConversationShortcuts({ navigate, toggleSider }), {
      initialProps: { toggleSider: firstToggle },
    });

    rerender({ toggleSider: secondToggle });
    dispatchShortcut(window, { key: 'b', metaKey: true });

    expect(firstToggle).not.toHaveBeenCalled();
    expect(secondToggle).toHaveBeenCalledTimes(1);
  });
});

describe('selected message Markdown copy shortcut', () => {
  beforeEach(() => {
    testState.mac = false;
    clipboardMocks.copyText.mockClear();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  const selectMessageHtml = (html: string, selector?: string): void => {
    const message = document.createElement('div');
    message.id = 'message-message-1';
    const content = document.createElement('div');
    content.dataset.testid = 'message-text-content';
    content.innerHTML = html;
    message.appendChild(content);
    document.body.appendChild(message);

    const selectedElement = selector ? content.querySelector(selector) : content;
    if (!selectedElement) throw new Error(`Missing selection target: ${selector}`);

    const range = document.createRange();
    range.selectNodeContents(selectedElement);
    Object.defineProperty(range, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 40, height: 20, left: 20, right: 120, top: 20, width: 100, x: 20, y: 20 }),
    });
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.mouseUp(selectedElement);
  };

  it('copies the selected rendered fragment as GFM with Ctrl+Alt+M', async () => {
    clipboardMocks.copyText.mockImplementationOnce(() => new Promise<void>(() => undefined));
    render(<SelectionReplyButton messages={[{ id: 'message-1', position: 'left' } as TMessage]} />);
    selectMessageHtml('<p><strong>Bold</strong> and <a href="https://example.com">link</a></p>');
    await screen.findByText('common.reply');
    await act(async () => undefined);

    const event = dispatchShortcut(window, { key: 'm', ctrlKey: true, altKey: true });

    await waitFor(() =>
      expect(clipboardMocks.copyText).toHaveBeenCalledWith('**Bold** and [link](https://example.com)')
    );
    expect(event.defaultPrevented).toBe(true);
  });

  it('copies a small blockquote selection immediately after mouseup', async () => {
    clipboardMocks.copyText.mockImplementationOnce(() => new Promise<void>(() => undefined));
    render(<SelectionReplyButton messages={[{ id: 'message-1', position: 'left' } as TMessage]} />);
    selectMessageHtml('<blockquote><p>Short quote</p></blockquote>', 'blockquote');

    const event = dispatchShortcut(window, { key: 'm', ctrlKey: true, altKey: true });

    await waitFor(() => expect(clipboardMocks.copyText).toHaveBeenCalledWith('> Short quote'));
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves the former Ctrl+Shift+M shortcut untouched after remapping', async () => {
    render(<SelectionReplyButton messages={[{ id: 'message-1', position: 'left' } as TMessage]} />);
    selectMessageHtml('<p>Selected text</p>');
    await screen.findByText('common.reply');

    const event = dispatchShortcut(window, { key: 'm', ctrlKey: true, shiftKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(clipboardMocks.copyText).not.toHaveBeenCalled();
  });

  it('preserves a selected fenced code block and its language', async () => {
    clipboardMocks.copyText.mockImplementationOnce(() => new Promise<void>(() => undefined));
    render(<SelectionReplyButton messages={[{ id: 'message-1', position: 'left' } as TMessage]} />);
    selectMessageHtml('<code class="language-ts">const value = 1;</code>', 'code');
    await screen.findByText('common.reply');
    await act(async () => undefined);

    dispatchShortcut(window, { key: 'm', ctrlKey: true, altKey: true });

    await waitFor(() => expect(clipboardMocks.copyText).toHaveBeenCalledWith('```ts\nconst value = 1;\n```'));
  });

  it('does not consume the shortcut when there is no message selection', () => {
    render(<SelectionReplyButton messages={[]} />);

    const event = dispatchShortcut(window, { key: 'm', ctrlKey: true, altKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(clipboardMocks.copyText).not.toHaveBeenCalled();
  });
});

describe('existing conversation search shortcuts', () => {
  beforeEach(() => {
    testState.mac = true;
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: globalThis.electronAPI,
    });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('opens current-conversation search with Cmd/Ctrl+F on desktop', () => {
    const { result } = renderHook(() => useMinimapPanel('conversation-1'));

    const event = dispatchShortcut(document.body, { key: 'f', metaKey: true });

    expect(result.current.visible).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves Ctrl+F untouched on macOS', () => {
    const { result } = renderHook(() => useMinimapPanel('conversation-1'));
    const input = document.createElement('textarea');
    document.body.appendChild(input);

    const event = dispatchShortcut(input, { key: 'f', ctrlKey: true });

    expect(result.current.visible).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not replace CodeMirror find with current-conversation search', () => {
    const { result } = renderHook(() => useMinimapPanel('conversation-1'));
    const editor = document.createElement('div');
    editor.className = 'cm-editor';
    document.body.appendChild(editor);

    const event = dispatchShortcut(editor, { key: 'f', metaKey: true });

    expect(result.current.visible).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('keeps current-conversation search available while the message input is focused', () => {
    const { result } = renderHook(() => useMinimapPanel('conversation-1'));
    const input = document.createElement('textarea');
    document.body.appendChild(input);

    const event = dispatchShortcut(input, { key: 'f', metaKey: true });

    expect(result.current.visible).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not consume current-conversation find when no conversation is active', () => {
    const { result } = renderHook(() => useMinimapPanel(undefined));

    const event = dispatchShortcut(document.body, { key: 'f', metaKey: true });

    expect(result.current.visible).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('opens global search with Cmd/Ctrl+Shift+F on desktop', () => {
    render(
      <ConversationSearchPopover
        renderTrigger={({ isActive }) => <div data-testid='global-search-state'>{String(isActive)}</div>}
      />
    );

    const event = dispatchShortcut(document.body, { key: 'f', metaKey: true, shiftKey: true });

    expect(screen.getByTestId('global-search-state')).toHaveTextContent('true');
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not replace Monaco find with global search', () => {
    render(
      <ConversationSearchPopover
        renderTrigger={({ isActive }) => <div data-testid='global-search-state'>{String(isActive)}</div>}
      />
    );
    const editor = document.createElement('div');
    editor.className = 'monaco-editor';
    document.body.appendChild(editor);

    const event = dispatchShortcut(editor, { key: 'f', metaKey: true, shiftKey: true });

    expect(screen.getByTestId('global-search-state')).toHaveTextContent('false');
    expect(event.defaultPrevented).toBe(false);
  });

  it('keeps global search available while the message input is focused', () => {
    render(
      <ConversationSearchPopover
        renderTrigger={({ isActive }) => <div data-testid='global-search-state'>{String(isActive)}</div>}
      />
    );
    const input = document.createElement('textarea');
    document.body.appendChild(input);

    const event = dispatchShortcut(input, { key: 'f', metaKey: true, shiftKey: true });

    expect(screen.getByTestId('global-search-state')).toHaveTextContent('true');
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not consume global search when the trigger is disabled', () => {
    render(
      <ConversationSearchPopover
        disabled
        renderTrigger={({ isActive }) => <div data-testid='global-search-state'>{String(isActive)}</div>}
      />
    );

    const event = dispatchShortcut(document.body, { key: 'f', metaKey: true, shiftKey: true });

    expect(screen.getByTestId('global-search-state')).toHaveTextContent('false');
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves current-conversation find to the browser in WebUI', () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: undefined,
    });
    const { result } = renderHook(() => useMinimapPanel('conversation-1'));

    const event = dispatchShortcut(document.body, { key: 'f', metaKey: true });

    expect(result.current.visible).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves global search to the browser in WebUI', () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: undefined,
    });
    render(
      <ConversationSearchPopover
        renderTrigger={({ isActive }) => <div data-testid='global-search-state'>{String(isActive)}</div>}
      />
    );

    const event = dispatchShortcut(document.body, { key: 'f', metaKey: true, shiftKey: true });

    expect(screen.getByTestId('global-search-state')).toHaveTextContent('false');
    expect(event.defaultPrevented).toBe(false);
  });

  it('removes the current-conversation search listener on unmount', () => {
    const { unmount } = renderHook(() => useMinimapPanel('conversation-1'));
    unmount();

    const event = dispatchShortcut(document.body, { key: 'f', metaKey: true });

    expect(event.defaultPrevented).toBe(false);
  });
});
