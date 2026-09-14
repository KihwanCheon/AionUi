/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';

export type ProjectGroupIndicatorStatus = 'none' | 'generating' | 'completion-unread';

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

/** Resolve the single aggregate status shown while a project group is collapsed. */
export const resolveProjectGroupIndicatorStatus = (
  expanded: boolean,
  conversations: TChatConversation[],
  isGenerating: (conversationId: string) => boolean,
  hasCompletionUnread: (conversationId: string) => boolean
): ProjectGroupIndicatorStatus => {
  if (expanded) return 'none';
  if (conversations.some((conversation) => isGenerating(conversation.id))) return 'generating';
  if (conversations.some((conversation) => hasCompletionUnread(conversation.id))) return 'completion-unread';
  return 'none';
};
