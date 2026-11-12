/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { getWorkspaceDisplayName } from '@/renderer/utils/workspace/workspace';

export type ConversationHistoryView = 'all' | 'bookmarks';

export type BookmarkGroup = {
  key: string;
  label: string;
  workspace?: string;
  conversations: TChatConversation[];
};

export const groupBookmarkedConversations = (
  conversations: TChatConversation[],
  t: (key: string) => string
): BookmarkGroup[] => {
  const groups = new Map<string, BookmarkGroup>();

  conversations.forEach((conversation) => {
    const workspace = conversation.extra?.custom_workspace ? conversation.extra.workspace?.trim() : undefined;
    const key = workspace ? `workspace:${workspace}` : 'without-project';
    const existing = groups.get(key);
    if (existing) {
      existing.conversations.push(conversation);
      return;
    }

    groups.set(key, {
      key,
      label: workspace
        ? getWorkspaceDisplayName(workspace, false, t)
        : t('conversation.history.bookmarksWithoutProject'),
      ...(workspace ? { workspace } : {}),
      conversations: [conversation],
    });
  });

  return [...groups.values()];
};
