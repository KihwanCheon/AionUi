/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';

export type ProjectGroupIndicatorStatus =
  | 'none'
  | 'generating'
  | 'completion-unread'
  | 'failure-unread'
  | 'generating-completion-unread'
  | 'failure-completion-unread';

export const isConversationWindowFocused = (): boolean => typeof document !== 'undefined' && document.hasFocus();

/**
 * Count unread completions that have a corresponding visible history row.
 * Team and health-check conversations live outside this list.
 */
export const countVisibleCompletionUnread = (
  conversations: TChatConversation[],
  completionUnreadIds: ReadonlySet<string>
): number =>
  conversations.reduce((total, conversation) => total + (completionUnreadIds.has(conversation.id) ? 1 : 0), 0);

/** Resolve the aggregate statuses shown while a project group is collapsed. */
export const resolveProjectGroupIndicatorStatus = (
  expanded: boolean,
  conversations: TChatConversation[],
  isGenerating: (conversationId: string) => boolean,
  hasCompletionUnread: (conversationId: string) => boolean,
  hasFailureUnread?: (conversationId: string) => boolean
): ProjectGroupIndicatorStatus => {
  if (expanded) return 'none';
  const generating = conversations.some((conversation) => isGenerating(conversation.id));
  const failureUnread = Boolean(
    hasFailureUnread && conversations.some((conversation) => hasFailureUnread(conversation.id))
  );
  const completionUnread = conversations.some((conversation) => hasCompletionUnread(conversation.id));
  if (generating) return completionUnread ? 'generating-completion-unread' : 'generating';
  if (failureUnread) return completionUnread ? 'failure-completion-unread' : 'failure-unread';
  if (completionUnread) return 'completion-unread';
  return 'none';
};
