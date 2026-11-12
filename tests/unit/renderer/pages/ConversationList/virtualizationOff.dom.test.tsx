/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConversationList from '@/renderer/pages/conversation/GroupedHistory/ConversationList';
import { CONVERSATION_LIST_VIRTUALIZATION_ENABLED } from '@/renderer/pages/conversation/GroupedHistory/ConversationList/viewport';

vi.mock('@/renderer/pages/conversation/GroupedHistory/ConversationList/SortableConversationRow', () => ({
  default: () => null,
}));

afterEach(() => {
  cleanup();
});

describe('sidebar conversation list with virtualization switched off', () => {
  it('keeps virtualization off by default', () => {
    expect(CONVERSATION_LIST_VIRTUALIZATION_ENABLED).toBe(false);
  });

  it('mounts every row so fast scrolling never shows empty space', async () => {
    const items = Array.from({ length: 200 }, (_, index) => ({ id: `row-${index}` }));
    const { container } = render(
      <div data-conversation-scroll>
        <ConversationList items={items} renderRow={(item) => <div data-testid={item.id}>{item.id}</div>} />
      </div>
    );
    await act(async () => {});

    expect(screen.getAllByTestId(/^row-/)).toHaveLength(200);
    expect(screen.getByTestId('row-199')).toBeInTheDocument();
    expect(container.querySelector('[data-virtual-conversation-list]')).toHaveStyle({ height: `${200 * 36 - 2}px` });
  });
});
