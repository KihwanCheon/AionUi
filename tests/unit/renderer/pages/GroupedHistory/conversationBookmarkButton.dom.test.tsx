/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import ConversationBookmarkButton from '@/renderer/pages/conversation/GroupedHistory/components/ConversationBookmarkButton';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const conversation = {
  id: 'bookmark-focus',
  name: 'Conversation',
  type: 'acp',
  created_at: 1,
  modified_at: 1,
  extra: { backend: 'codex' },
  model: {},
} as TChatConversation;

const BookmarkHarness = ({ initiallyPinned = false }: { initiallyPinned?: boolean }) => {
  const [isPinned, setIsPinned] = React.useState(initiallyPinned);
  return (
    <div className='group'>
      <ConversationBookmarkButton
        conversation={conversation}
        isPinned={isPinned}
        isMobile={false}
        statusLayout='gutter'
        onTogglePin={() => setIsPinned((pinned) => !pinned)}
      />
    </div>
  );
};

describe('bookmark visibility after unpinning', () => {
  it('reveals an unpinned desktop bookmark for hover or keyboard focus, not generic focus', () => {
    render(<BookmarkHarness />);

    const button = screen.getByRole('button');
    expect(button).toHaveClass('opacity-0', 'group-hover:opacity-100', 'focus-visible:opacity-100');
    expect(button).not.toHaveClass('focus:opacity-100');
  });

  it('does not use residual pointer focus to reveal the bookmark after pinning and unpinning', async () => {
    const user = userEvent.setup();
    render(<BookmarkHarness />);
    const button = screen.getByRole('button');

    await user.click(button);
    await user.click(button);
    await user.unhover(button);

    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-label', 'conversation.history.addBookmark');
    expect(button).not.toHaveClass('focus:opacity-100');
  });

  it('retains keyboard focus and its visibility affordance after toggling the bookmark', async () => {
    const user = userEvent.setup();
    render(<BookmarkHarness />);
    const button = screen.getByRole('button');

    await user.tab();
    await user.keyboard('{Enter}');
    await user.keyboard('{Enter}');

    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-label', 'conversation.history.addBookmark');
    expect(button).toHaveClass('focus-visible:opacity-100');
  });

  it.each([false, true])('keeps the mobile bookmark always visible (pinned=%s)', (isPinned) => {
    render(
      <ConversationBookmarkButton conversation={conversation} isPinned={isPinned} isMobile onTogglePin={vi.fn()} />
    );

    expect(screen.getByRole('button')).not.toHaveClass('opacity-0');
  });

  it('keeps a pinned desktop bookmark visible without requiring hover or focus', () => {
    render(<BookmarkHarness initiallyPinned />);

    expect(screen.getByRole('button')).not.toHaveClass('opacity-0');
  });
});
