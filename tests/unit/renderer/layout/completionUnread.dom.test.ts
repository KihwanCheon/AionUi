import type { TChatConversation } from '@/common/config/storage';
import {
  countVisibleCompletionUnread,
  isConversationWindowFocused,
  resolveProjectGroupIndicatorStatus,
} from '@/renderer/pages/conversation/GroupedHistory/utils/completionUnread';
import ProjectGroupHeader from '@/renderer/pages/conversation/GroupedHistory/components/ProjectGroupHeader';
import WorkspaceCollapse from '@/renderer/pages/conversation/components/WorkspaceCollapse';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

const conversation = (id: string): TChatConversation => ({ id }) as TChatConversation;

describe('completion unread taskbar state', () => {
  it('counts only unread ids present in the visible conversation list', () => {
    expect(
      countVisibleCompletionUnread(
        [conversation('visible-1'), conversation('visible-2')],
        new Set(['visible-1', 'team-hidden'])
      )
    ).toBe(1);
  });

  it('uses document focus to decide whether the active conversation is visible to the user', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    expect(isConversationWindowFocused()).toBe(false);

    vi.mocked(document.hasFocus).mockReturnValue(true);
    expect(isConversationWindowFocused()).toBe(true);
  });
});

describe('project completion unread state', () => {
  it('shows an unread marker on a collapsed project with unread completions', () => {
    render(
      React.createElement(WorkspaceCollapse, {
        expanded: false,
        onToggle: vi.fn(),
        header: React.createElement(ProjectGroupHeader, {
          workspace: 'C:\\Git\\AionUi\\AionUi',
          displayName: 'AionUi',
          indicatorStatus: 'completion-unread',
        }),
        children: null,
      })
    );

    const marker = screen.getByTestId('project-completion-unread');
    expect(marker).toHaveClass('bg-[var(--conversation-completion-unread)]');
    expect(marker).toHaveClass('absolute', 'right-8px', 'group-hover:hidden');
    expect(marker.closest('.workspace-collapse')?.querySelector('.group')).toHaveClass('relative');
  });

  it('does not show a project marker when its conversations are visible', () => {
    render(
      React.createElement(ProjectGroupHeader, {
        workspace: 'C:\\Git\\AionUi\\AionUi',
        displayName: 'AionUi',
      })
    );

    expect(screen.queryByTestId('project-completion-unread')).not.toBeInTheDocument();
  });

  it('shows the conversation spinner in the project status slot while a collapsed child is generating', () => {
    render(
      React.createElement(WorkspaceCollapse, {
        expanded: false,
        onToggle: vi.fn(),
        header: React.createElement(ProjectGroupHeader, {
          workspace: 'C:\\Git\\AionUi\\AionUi',
          displayName: 'AionUi',
          indicatorStatus: 'generating',
        }),
        children: null,
      })
    );

    const marker = screen.getByTestId('project-generating');
    expect(marker).toHaveClass('absolute', 'right-8px', 'group-hover:hidden');
    expect(screen.queryByTestId('project-completion-unread')).not.toBeInTheDocument();
  });
});

describe('project aggregate indicator priority', () => {
  const groupedConversations = [conversation('generating'), conversation('unread')];

  it('prioritizes a generating child over an unread completion in a collapsed project', () => {
    const status = resolveProjectGroupIndicatorStatus(
      false,
      groupedConversations,
      (id) => id === 'generating',
      (id) => id === 'unread'
    );

    expect(status).toBe('generating');
  });

  it('shows the unread completion after no child is generating', () => {
    const status = resolveProjectGroupIndicatorStatus(
      false,
      groupedConversations,
      () => false,
      (id) => id === 'unread'
    );

    expect(status).toBe('completion-unread');
  });

  it('does not aggregate child state while the project is expanded', () => {
    const status = resolveProjectGroupIndicatorStatus(
      true,
      groupedConversations,
      () => true,
      () => true
    );

    expect(status).toBe('none');
  });
});
