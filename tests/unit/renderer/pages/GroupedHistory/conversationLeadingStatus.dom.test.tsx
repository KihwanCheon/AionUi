/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const layout = vi.hoisted(() => ({ isMobile: false }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({
  usePresetAssistantInfo: () => ({ info: null }),
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => layout }));
vi.mock('@/renderer/utils/model/agentLogo', () => ({
  useAgentLogos: () => ({ codex: '/codex.png', claude: '/claude.png' }),
  resolveAgentLogo: (logos: Record<string, string>, { backend }: { backend?: string | null }) =>
    logos[backend ?? ''] ?? null,
}));
vi.mock('@/renderer/pages/cron', () => ({
  CronJobIndicator: () => <span data-testid='cron-identity' />,
}));
vi.mock('@/renderer/utils/ui/siderTooltip', () => ({
  cleanupSiderTooltips: vi.fn(),
  getSiderTooltipProps: () => ({ disabled: true }),
}));

import ConversationRow from '@/renderer/pages/conversation/GroupedHistory/ConversationRow';
import type { ConversationRowProps } from '@/renderer/pages/conversation/GroupedHistory/types';

const conversation = {
  id: 'activity-row',
  name: 'Conversation',
  type: 'acp',
  created_at: 1,
  modified_at: 1,
  extra: { backend: 'codex' },
  model: {},
} as TChatConversation;

const makeProps = (overrides: Partial<ConversationRowProps> = {}): ConversationRowProps => ({
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
  ...overrides,
});

const indicatorId = 'conversation-generating-indicator-activity-row';
const waitingId = 'conversation-waiting-confirmation-activity-row';

describe('conversation identity with activity decorations', () => {
  beforeEach(() => {
    layout.isMobile = false;
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each(['codex', 'claude'])('keeps the %s identity inside the existing slot while generating', (backend) => {
    render(
      <ConversationRow
        {...makeProps({
          conversation: { ...conversation, extra: { backend } } as TChatConversation,
          isGenerating: true,
        })}
      />
    );

    const slot = screen.getByTestId('conversation-leading-icon-activity-row');
    expect(slot).toHaveClass('size-22px', 'relative');
    expect(slot).toContainElement(screen.getByRole('img', { name: backend }));
    expect(slot).toContainElement(screen.getByTestId(indicatorId));
  });

  it('keeps the logo mounted through generation, confirmation, and completion', () => {
    const props = makeProps({ isGenerating: true });
    const { rerender } = render(<ConversationRow {...props} />);
    const logo = screen.getByRole('img', { name: 'codex' });

    rerender(<ConversationRow {...props} isWaitingConfirmation />);
    expect(screen.getByRole('img', { name: 'codex' })).toBe(logo);
    rerender(<ConversationRow {...props} isWaitingConfirmation={false} />);
    expect(screen.getByRole('img', { name: 'codex' })).toBe(logo);
    rerender(<ConversationRow {...props} isGenerating={false} />);
    expect(screen.getByRole('img', { name: 'codex' })).toBe(logo);
  });

  it('uses the original spinner on the leading side without adding a layout slot', () => {
    render(<ConversationRow {...makeProps({ isGenerating: true })} />);

    const indicator = screen.getByTestId(indicatorId);
    expect(indicator).toHaveClass('arco-spin');
    expect(indicator.querySelector('svg')).toHaveAttribute('stroke-width', '4');
    expect(indicator.parentElement).toHaveClass('absolute', '-start-12px', 'size-16px', 'pointer-events-none');
  });

  it('keeps the bookmark close before status without changing the project indentation', () => {
    render(<ConversationRow {...makeProps({ dimIcon: true, isGenerating: true })} />);

    expect(document.getElementById('c-activity-row')).toHaveClass('ps-34px');
    expect(screen.getByTestId(indicatorId).parentElement).toHaveClass('-start-26px');
    expect(screen.getByTestId('conversation-bookmark-activity-row')).toHaveClass(
      '-translate-x-15px',
      'rtl:translate-x-15px'
    );
  });

  it('keeps bookmark and status inside a compact row without increasing its indentation', () => {
    render(<ConversationRow {...makeProps({ isGenerating: true })} />);

    expect(document.getElementById('c-activity-row')).toHaveClass('ps-10px');
    expect(screen.getByTestId(indicatorId).parentElement).toHaveClass('-start-12px');
    expect(screen.getByTestId('conversation-bookmark-activity-row')).toHaveClass(
      '-translate-x-1px',
      'rtl:translate-x-1px'
    );
  });

  it('keeps the close bookmark position fixed through generation and confirmation', () => {
    const props = makeProps({ dimIcon: true });
    const { rerender } = render(<ConversationRow {...props} />);
    const bookmark = screen.getByTestId('conversation-bookmark-activity-row');
    const initialClassName = bookmark.className;

    rerender(<ConversationRow {...props} isGenerating />);
    expect(bookmark.className).toBe(initialClassName);
    rerender(<ConversationRow {...props} isGenerating isWaitingConfirmation />);
    expect(bookmark.className).toBe(initialClassName);
  });

  it.each([false, true])('keeps the relocated bookmark clickable during generation (project=%s)', (dimIcon) => {
    const props = makeProps({ dimIcon, isGenerating: true });
    render(<ConversationRow {...props} />);
    fireEvent.click(screen.getByTestId('conversation-bookmark-activity-row'));

    expect(props.onTogglePin).toHaveBeenCalledWith(conversation);
    expect(props.onConversationClick).not.toHaveBeenCalled();
  });

  it('does not apply the project gutter offset when the sidebar is collapsed', () => {
    render(<ConversationRow {...makeProps({ dimIcon: true, collapsed: true, isGenerating: true })} />);

    expect(screen.getByTestId(indicatorId).parentElement).toHaveClass('-start-12px');
    expect(screen.queryByTestId('conversation-bookmark-activity-row')).not.toBeInTheDocument();
  });

  it.each([
    { isGenerating: false },
    { isGenerating: true },
    { isGenerating: true, isWaitingConfirmation: true },
    { isGenerating: true, batchMode: true },
  ])('keeps normal identity opacity regardless of activity: %o', (state) => {
    render(<ConversationRow {...makeProps(state)} />);

    expect(screen.getByRole('img', { name: 'codex' }).closest('.opacity-40')).toBeNull();
  });

  it('keeps the identity visible when confirmation suppresses the generating spinner', () => {
    render(<ConversationRow {...makeProps({ isGenerating: true, isWaitingConfirmation: true })} />);

    expect(screen.getByRole('img', { name: 'codex' })).toBeInTheDocument();
    expect(screen.getByTestId(waitingId)).toBeInTheDocument();
    expect(screen.queryByTestId(indicatorId)).not.toBeInTheDocument();
  });

  it('keeps the provider and adjacent spinner visible in the collapsed sidebar', () => {
    render(<ConversationRow {...makeProps({ collapsed: true, isGenerating: true })} />);

    expect(document.getElementById('c-activity-row')).toHaveClass('justify-center', 'px-0');
    expect(screen.getByRole('img', { name: 'codex' })).toBeInTheDocument();
    expect(screen.getByTestId(indicatorId)).toBeInTheDocument();
  });

  it.each([
    { isGenerating: true, isWaitingConfirmation: false },
    { isGenerating: true, isWaitingConfirmation: true },
  ])('does not fade pinned identity on hover during activity: %o', (activity) => {
    render(
      <ConversationRow
        {...makeProps({
          conversation: { ...conversation, pinned: true },
          dragHandle: <span data-testid='drag-handle' />,
          ...activity,
        })}
      />
    );

    expect(screen.getByRole('img', { name: 'codex' })).not.toHaveClass('group-hover:opacity-0');
    expect(screen.queryByTestId('drag-handle')).not.toBeInTheDocument();
  });

  it('preserves the pinned drag overlay when idle on desktop', () => {
    render(
      <ConversationRow
        {...makeProps({
          conversation: { ...conversation, pinned: true },
          dragHandle: <span data-testid='drag-handle' />,
        })}
      />
    );

    expect(screen.getByRole('img', { name: 'codex' })).toHaveClass('group-hover:opacity-0');
    expect(screen.getByTestId('drag-handle')).toBeInTheDocument();
    expect(screen.queryByTestId(indicatorId)).not.toBeInTheDocument();
  });

  it('does not fade pinned identity where mobile has no drag overlay', () => {
    layout.isMobile = true;
    render(<ConversationRow {...makeProps({ conversation: { ...conversation, pinned: true } })} />);

    expect(screen.getByRole('img', { name: 'codex' })).not.toHaveClass('group-hover:opacity-0');
  });

  it.each([false, true])('suppresses activity decoration in batch mode (waiting=%s)', (isWaitingConfirmation) => {
    render(<ConversationRow {...makeProps({ batchMode: true, isGenerating: true, isWaitingConfirmation })} />);

    expect(screen.getByRole('img', { name: 'codex' })).toBeInTheDocument();
    expect(screen.queryByTestId(indicatorId)).not.toBeInTheDocument();
    expect(screen.queryByTestId(waitingId)).not.toBeInTheDocument();
  });

  it('keeps normal conversation selection through the decorated slot', () => {
    const props = makeProps({ isGenerating: true });
    render(<ConversationRow {...props} />);
    fireEvent.click(screen.getByTestId(indicatorId));

    expect(props.onConversationClick).toHaveBeenCalledWith(conversation);
    expect(props.onToggleChecked).not.toHaveBeenCalled();
  });

  it('keeps a custom assistant emoji while generating', () => {
    render(
      <ConversationRow
        {...makeProps({
          conversation: {
            ...conversation,
            assistant: { id: 'custom', name: 'Custom', backend: 'codex', avatar: '🤖' },
          } as TChatConversation,
          isGenerating: true,
        })}
      />
    );

    expect(screen.getByText('🤖')).toBeInTheDocument();
    expect(screen.getByTestId(indicatorId)).toBeInTheDocument();
  });

  it('keeps the existing cron identity while generating', () => {
    render(<ConversationRow {...makeProps({ getJobStatus: () => 'active', isGenerating: true })} />);

    expect(screen.getByTestId('cron-identity')).toBeInTheDocument();
    expect(screen.getByTestId(indicatorId)).toBeInTheDocument();
  });

  it('still shows a leading fallback and spinner when a provider logo is unavailable', () => {
    render(
      <ConversationRow
        {...makeProps({
          conversation: { ...conversation, extra: { backend: 'unknown' } } as TChatConversation,
          isGenerating: true,
        })}
      />
    );

    const slot = screen.getByTestId('conversation-leading-icon-activity-row');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(slot.querySelector('svg')).not.toBeNull();
    expect(slot).toContainElement(screen.getByTestId(indicatorId));
  });
});
