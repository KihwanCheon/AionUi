/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({
  usePresetAssistantInfo: () => ({ info: null }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/pages/conversation/utils/conversationAssistantIdentity', () => ({
  resolveConversationLeadingMark: () => ({ kind: 'default' }),
}));

vi.mock('@/renderer/pages/cron', () => ({
  CronJobIndicator: () => null,
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({
  useAgentLogos: () => ({}),
}));

vi.mock('@/renderer/utils/ui/siderTooltip', () => ({
  cleanupSiderTooltips: vi.fn(),
  getSiderTooltipProps: () => ({ disabled: true }),
}));

import ConversationRow from '@/renderer/pages/conversation/GroupedHistory/ConversationRow';
import type { ConversationRowProps } from '@/renderer/pages/conversation/GroupedHistory/types';

const conversation = {
  id: 'cron-menu-conversation',
  name: 'Scheduled task source',
  type: 'acp',
  created_at: 1,
  modified_at: 1,
  extra: { backend: 'claude' },
  model: {},
} as TChatConversation;

const makeProps = (overrides: Partial<ConversationRowProps> = {}): ConversationRowProps => ({
  conversation,
  isGenerating: false,
  hasUnread: false,
  collapsed: false,
  tooltipEnabled: false,
  batchMode: false,
  checked: false,
  selected: false,
  menuVisible: true,
  onToggleChecked: vi.fn(),
  onConversationClick: vi.fn(),
  onOpenMenu: vi.fn(),
  onMenuVisibleChange: vi.fn(),
  onEditStart: vi.fn(),
  onCreateCronTask: vi.fn(),
  onArchive: vi.fn(),
  onTogglePin: vi.fn(),
  getJobStatus: () => 'none',
  ...overrides,
});

describe('conversation scheduled-task menu item', () => {
  it('renders the Timer action between Rename and Archive and invokes it for the selected row', async () => {
    const onCreateCronTask = vi.fn();
    const onEditStart = vi.fn();
    const onArchive = vi.fn();
    render(<ConversationRow {...makeProps({ onCreateCronTask, onArchive, onEditStart })} />);

    const rename = await screen.findByText('conversation.history.rename');
    const createCronTask = screen.getByText('conversation.history.createCronTask');
    const archiveItem = screen.getByText('conversation.history.archive');

    expect(rename.compareDocumentPosition(createCronTask) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(createCronTask.compareDocumentPosition(archiveItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(rename);
    await waitFor(() => expect(onEditStart).toHaveBeenCalledWith(conversation));
    fireEvent.click(archiveItem);
    await waitFor(() => expect(onArchive).toHaveBeenCalledWith(conversation));
    fireEvent.click(createCronTask);
    await waitFor(() => expect(onCreateCronTask).toHaveBeenCalledWith(conversation));
  });

  it('keeps row actions hidden while batch selection is active', () => {
    render(<ConversationRow {...makeProps({ batchMode: true, menuVisible: false })} />);

    expect(screen.queryByText('conversation.history.createCronTask')).not.toBeInTheDocument();
  });

  it('offers permanent deletion after archive and targets the selected conversation', async () => {
    const onPermanentDelete = vi.fn();
    render(<ConversationRow {...makeProps({ onPermanentDelete })} />);

    const archiveItem = await screen.findByText('conversation.history.archive');
    const permanentDeleteItem = screen.getByText('conversation.history.permanentDelete');

    expect(archiveItem.compareDocumentPosition(permanentDeleteItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(permanentDeleteItem);
    await waitFor(() => expect(onPermanentDelete).toHaveBeenCalledWith(conversation));
  });

  it('keeps the open menu bound to the conversation that opened it while the row changes', async () => {
    const onArchive = vi.fn();
    const refreshedConversation = {
      ...conversation,
      name: 'Conversation refreshed while its menu is open',
      modified_at: 2,
    };
    const { rerender } = render(<ConversationRow {...makeProps({ onArchive })} />);
    await screen.findByText('conversation.history.archive');

    rerender(<ConversationRow {...makeProps({ conversation: refreshedConversation, onArchive })} />);
    fireEvent.click(screen.getByText('conversation.history.archive'));

    await waitFor(() => expect(onArchive).toHaveBeenCalledWith(conversation));
  });

  it('removes the menu content from the document after the menu closes', async () => {
    const { rerender } = render(<ConversationRow {...makeProps()} />);
    await screen.findByText('conversation.history.archive');

    rerender(<ConversationRow {...makeProps({ menuVisible: false })} />);

    await waitFor(() => expect(screen.queryByText('conversation.history.archive')).not.toBeInTheDocument());
  });

  it('toggles the bookmark without opening the conversation', () => {
    const onTogglePin = vi.fn();
    const onConversationClick = vi.fn();
    render(<ConversationRow {...makeProps({ menuVisible: false, onTogglePin, onConversationClick })} />);

    fireEvent.click(screen.getByTestId(`conversation-bookmark-${conversation.id}`));

    expect(onTogglePin).toHaveBeenCalledWith(conversation);
    expect(onConversationClick).not.toHaveBeenCalled();
  });

  it('places the bookmark before the AI model icon', () => {
    render(<ConversationRow {...makeProps({ menuVisible: false })} />);

    const bookmark = screen.getByTestId(`conversation-bookmark-${conversation.id}`);
    const leadingIcon = screen.getByTestId(`conversation-leading-icon-${conversation.id}`);

    expect(bookmark.compareDocumentPosition(leadingIcon) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bookmark).toHaveClass('!inline-flex', '!items-center', '!justify-center', '!leading-none');
  });
});
