/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';

vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({
  usePresetAssistantInfo: () => ({ info: null }),
}));
vi.mock('@/renderer/utils/model/agentLogo', () => ({ useAgentLogos: () => ({}) }));
vi.mock('@/renderer/pages/cron', () => ({ CronJobIndicator: () => null }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));
vi.mock('@/renderer/pages/conversation/utils/conversationAssistantIdentity', () => ({
  resolveConversationLeadingMark: () => ({ kind: 'default' }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import ConversationRow from '@/renderer/pages/conversation/GroupedHistory/ConversationRow';
import type { ConversationRowProps } from '@/renderer/pages/conversation/GroupedHistory/types';
import {
  NotificationHighlightProvider,
  useNotificationHighlight,
} from '@/renderer/hooks/context/UserChoiceNotifications/NotificationHighlight';
import highlightStyles from '@/renderer/hooks/context/UserChoiceNotifications/highlight.module.css';

const conversation = {
  id: 'conv-1',
  name: 'Chat',
  type: 'acp',
  created_at: 1,
  modified_at: 1,
  extra: {},
} as unknown as TChatConversation;

const baseProps: ConversationRowProps = {
  conversation,
  isGenerating: false,
  isWaitingConfirmation: false,
  hasUnread: false,
  isManualUnread: false,
  collapsed: false,
  tooltipEnabled: false,
  batchMode: false,
  checked: false,
  selected: false,
  menuVisible: false,
  onToggleChecked: vi.fn(),
  onConversationClick: vi.fn(),
  onOpenMenu: vi.fn(),
  onMenuVisibleChange: vi.fn(),
  onEditStart: vi.fn(),
  onCreateCronTask: vi.fn(),
  onArchive: vi.fn(),
  onTogglePin: vi.fn(),
  onToggleManualUnread: vi.fn(),
  getJobStatus: () => 'none',
};

const renderRow = (props: Partial<ConversationRowProps>) => render(<ConversationRow {...baseProps} {...props} />);
let titleClientWidth = 120;
let titleScrollWidth = 240;

describe('ConversationRow', () => {
  beforeEach(() => {
    titleClientWidth = 120;
    titleScrollWidth = 240;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () {
      return this.classList.contains('conversation-title-text') ? titleClientWidth : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function () {
      return this.classList.contains('conversation-title-text') ? titleScrollWidth : 0;
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('uses the same outline with a distinct sender tone, then restores notification styling', () => {
    const Preview = ({ source }: { source: boolean }) => {
      const { highlight, clear } = useNotificationHighlight();
      React.useEffect(() => {
        highlight({ key: 'preview', conversationId: conversation.id, ...(source && { tone: 'source' as const }) });
        return () => clear('preview');
      }, [source, highlight, clear]);
      return null;
    };
    const view = (source: boolean) => (
      <NotificationHighlightProvider>
        <Preview source={source} />
        <ConversationRow {...baseProps} />
        <ConversationRow {...baseProps} conversation={{ ...conversation, id: 'other' }} />
      </NotificationHighlightProvider>
    );
    const { rerender } = render(view(true));
    const row = document.getElementById('c-conv-1');
    expect(row).toHaveClass(highlightStyles.conversation, highlightStyles.sourceConversation);
    expect(document.getElementById('c-other')).not.toHaveClass(highlightStyles.conversation);
    rerender(view(false));
    expect(row).toHaveClass(highlightStyles.conversation);
    expect(row).not.toHaveClass(highlightStyles.sourceConversation);
  });

  it('shows the full conversation title when hovering anywhere on an expanded desktop row', async () => {
    const title = 'A conversation title that is longer than the available sidebar width';
    const user = userEvent.setup();
    renderRow({ conversation: { ...conversation, name: title } as TChatConversation });

    await user.hover(document.getElementById('c-conv-1')!);

    await waitFor(() => expect(screen.getAllByText(title)).toHaveLength(2));
    const popup = screen.getByRole('tooltip').closest('.conversation-title-tooltip-popup');
    expect(popup?.parentElement?.parentElement).toBe(document.body);
    expect(popup).toHaveStyle({ maxWidth: '350px' });

    await user.click(document.getElementById('c-conv-1')!);
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('does not show a tooltip when the full title fits without an ellipsis', async () => {
    titleClientWidth = 240;
    titleScrollWidth = 120;
    const user = userEvent.setup();
    renderRow({});

    await user.hover(document.getElementById('c-conv-1')!);

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows MnP document and card titles on separate lines in document-first order', async () => {
    const user = userEvent.setup();
    renderRow({ conversation: { ...conversation, name: 'Document title: Card title' } as TChatConversation });

    await user.hover(document.getElementById('c-conv-1')!);

    const tooltip = await screen.findByRole('tooltip');
    const cardTitle = screen.getByText('Card title');
    const documentTitle = screen.getByText('Document title');
    expect(cardTitle.parentElement).toBe(documentTitle.parentElement);
    expect(Array.from(cardTitle.parentElement!.children).map((line) => line.textContent)).toEqual([
      'Document title',
      'Card title',
    ]);
    expect(tooltip).toContainElement(cardTitle);
    expect(tooltip.closest('.conversation-title-tooltip-popup')).toHaveStyle({
      width: 'max-content',
      maxWidth: 'none',
    });
  });

  it('shows the waiting-confirmation icon (not the spinner) when waiting takes precedence over generating', () => {
    const { container } = renderRow({ isWaitingConfirmation: true, isGenerating: true });
    expect(screen.getByTestId('conversation-waiting-confirmation-conv-1')).toBeInTheDocument();
    expect(container.querySelector('.arco-spin')).toBeNull();
  });

  it('shows the generating spinner when generating but not waiting', () => {
    const { container } = renderRow({ isWaitingConfirmation: false, isGenerating: true });
    expect(screen.queryByTestId('conversation-waiting-confirmation-conv-1')).toBeNull();
    expect(container.querySelector('.arco-spin')).not.toBeNull();
  });

  it('shows neither the waiting icon nor the spinner when idle', () => {
    const { container } = renderRow({ isWaitingConfirmation: false, isGenerating: false });
    expect(screen.queryByTestId('conversation-waiting-confirmation-conv-1')).toBeNull();
    expect(container.querySelector('.arco-spin')).toBeNull();
  });

  it('does not show the waiting icon in batch mode (selection UI takes over)', () => {
    renderRow({ isWaitingConfirmation: true, batchMode: true });
    expect(screen.queryByTestId('conversation-waiting-confirmation-conv-1')).toBeNull();
  });
});
