import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcBridge } from '@/common';
import { mindNProgressConversationApi } from '@/renderer/components/chat/SendBox/MindNProgressConversationLink';
import MnpUnlinkedConversationsModal from '@/renderer/pages/conversation/GroupedHistory/components/MnpUnlinkedConversationsModal';
import { conversation, link } from './fixtures';

vi.mock('@/common', () => ({ ipcBridge: { sidebar: { archive: { invoke: vi.fn() } } } }));
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: vi.fn() } }));
vi.mock('@/renderer/hooks/context/ThemeContext', () => ({ useThemeContext: () => ({ fontScale: 1 }) }));
vi.mock('@/renderer/components/chat/SendBox/MindNProgressConversationLink', () => ({
  mindNProgressConversationApi: { lookup: vi.fn() },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.name) return `${key}:${options.name}`;
      if (options?.count !== undefined) return `${key}:${options.count}`;
      return key;
    },
  }),
}));

const renderModal = (ids: string[]) =>
  render(
    <MnpUnlinkedConversationsModal
      groupName='Project'
      conversations={ids.map(conversation)}
      isConversationGenerating={() => false}
      onClose={vi.fn()}
    />
  );

beforeEach(() => {
  vi.mocked(mindNProgressConversationApi.lookup)
    .mockReset()
    .mockImplementation(async (id) => link(id));
  vi.mocked(ipcBridge.sidebar.archive.invoke).mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('MnP unlinked conversation dialog', () => {
  it('archives a single row using the same sidebar endpoint as the context menu', async () => {
    renderModal(['a', 'b']);
    const row = (
      await screen.findByRole('checkbox', { name: 'conversation.mnpUnlinked.selectConversation:a' })
    ).closest('li')!;
    await waitFor(() => expect(within(row).getByRole('button')).toBeEnabled());
    fireEvent.click(within(row).getByRole('button', { name: 'conversation.history.archive' }));
    await waitFor(() =>
      expect(ipcBridge.sidebar.archive.invoke).toHaveBeenCalledWith({ item_type: 'conversation', item_id: 'a' })
    );
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: 'conversation.mnpUnlinked.selectConversation:a' })).toBeNull()
    );
    expect(screen.getByRole('checkbox', { name: 'conversation.mnpUnlinked.selectConversation:b' })).toBeInTheDocument();
  });

  it('supports select all and keeps failed rows available for another archive attempt', async () => {
    vi.mocked(ipcBridge.sidebar.archive.invoke).mockImplementation(async ({ item_id }) => {
      if (item_id === 'b') throw new Error('write failed');
    });
    renderModal(['a', 'b']);
    const selectAll = await screen.findByRole('checkbox', { name: 'conversation.mnpUnlinked.selectAll:2' });
    await waitFor(() => expect(selectAll).toBeEnabled());
    fireEvent.click(selectAll);
    fireEvent.click(screen.getByRole('button', { name: 'conversation.mnpUnlinked.archiveSelected:2' }));
    await screen.findByText('conversation.history.archiveFailed');
    expect(ipcBridge.sidebar.archive.invoke).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('checkbox', { name: 'conversation.mnpUnlinked.selectConversation:a' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'conversation.mnpUnlinked.selectConversation:b' })).toBeChecked();
  });

  it('shows lookup errors separately from the selectable list', async () => {
    vi.mocked(mindNProgressConversationApi.lookup).mockImplementation(async (id) => {
      if (id === 'failed') throw new Error('offline');
      return link(id, id === 'linked');
    });
    renderModal(['unlinked', 'linked', 'failed']);
    await screen.findByText('conversation.mnpUnlinked.lookupFailed:1');
    expect(
      screen.getByRole('checkbox', { name: 'conversation.mnpUnlinked.selectConversation:unlinked' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'conversation.mnpUnlinked.selectConversation:failed' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'conversation.mnpUnlinked.selectConversation:linked' })).toBeNull();
  });
});
