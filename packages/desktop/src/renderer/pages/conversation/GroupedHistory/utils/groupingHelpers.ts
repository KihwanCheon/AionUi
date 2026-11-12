/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { getActivityTime } from '@/renderer/utils/chat/timeline';
import { getWorkspaceDisplayName } from '@/renderer/utils/workspace/workspace';
import { getWorkspaceUpdateTime } from '@/renderer/utils/workspace/workspaceHistory';

import type { GroupedHistoryResult, TimelineItem, TimelineSection } from '../types';
import { getConversationSortOrder } from './sortOrderHelpers';

export const isConversationPinned = (conversation: TChatConversation): boolean => {
  const canonical = conversation as TChatConversation & { pinned?: boolean };
  const extra = conversation.extra as { pinned?: boolean } | undefined;
  return canonical.pinned === true || extra?.pinned === true;
};

export const getConversationPinnedAt = (conversation: TChatConversation): number => {
  const canonical = conversation as TChatConversation & { pinned_at?: number };
  const extra = conversation.extra as { pinned_at?: number } | undefined;
  if (typeof canonical.pinned_at === 'number') {
    return canonical.pinned_at;
  }
  if (typeof extra?.pinned_at === 'number') {
    return extra.pinned_at;
  }
  return 0;
};

export const groupConversationsByWorkspace = (
  conversations: TChatConversation[],
  t: (key: string) => string
): TimelineSection[] => {
  const allWorkspaceGroups = new Map<string, TChatConversation[]>();
  const withoutWorkspaceConvs: TChatConversation[] = [];

  conversations.forEach((conv) => {
    const workspace = conv.extra?.workspace;
    const custom_workspace = conv.extra?.custom_workspace;

    if (custom_workspace && workspace) {
      if (!allWorkspaceGroups.has(workspace)) {
        allWorkspaceGroups.set(workspace, []);
      }
      allWorkspaceGroups.get(workspace)!.push(conv);
    } else {
      withoutWorkspaceConvs.push(conv);
    }
  });

  const items: TimelineItem[] = [];

  allWorkspaceGroups.forEach((convList, workspace) => {
    const sortedConvs = [...convList].toSorted((a, b) => getActivityTime(b) - getActivityTime(a));
    const latestConversationTime = getActivityTime(sortedConvs[0]);
    const updateTime = getWorkspaceUpdateTime(workspace);
    const time = Math.max(updateTime, latestConversationTime);
    items.push({
      type: 'workspace',
      time,
      workspaceGroup: {
        workspace,
        // This grouping path only sees custom (user-chosen) workspaces —
        // non-custom conversations end up in `withoutWorkspaceConvs` above
        // and never reach this helper. Passing `false` is therefore correct
        // without consulting `extra.is_temporary_workspace` per-row.
        display_name: getWorkspaceDisplayName(workspace, false, t),
        conversations: sortedConvs,
      },
    });
  });

  withoutWorkspaceConvs.forEach((conv) => {
    items.push({
      type: 'conversation',
      time: getActivityTime(conv),
      conversation: conv,
    });
  });

  items.sort((a, b) => b.time - a.time);

  if (items.length === 0) return [];

  return [
    {
      timeline: t('conversation.history.recents'),
      items,
    },
  ];
};

/** Check whether a conversation belongs to a team (should be hidden from sidebar). */
const isTeamConversation = (conversation: TChatConversation): boolean => {
  const extra = conversation.extra as { team_id?: string; teamId?: string } | undefined;
  return Boolean(extra?.team_id || extra?.teamId);
};

const isLegacyArchivedConversation = (conversation: TChatConversation): boolean => {
  const extra = conversation.extra as { archived?: boolean } | undefined;
  return extra?.archived === true;
};

export const buildGroupedHistory = (
  conversations: TChatConversation[],
  t: (key: string) => string
): GroupedHistoryResult => {
  // The upstream active sidebar already excludes archived rows. Keep the legacy
  // extra flag guard so stale fork-era rows cannot reappear in bookmarks.
  const visibleConversations = conversations.filter(
    (conversation) => !isTeamConversation(conversation) && !isLegacyArchivedConversation(conversation)
  );

  const pinnedConversations = visibleConversations
    .filter((conversation) => isConversationPinned(conversation))
    .toSorted((a, b) => {
      const orderA = getConversationSortOrder(a);
      const orderB = getConversationSortOrder(b);
      if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
      if (orderA !== undefined) return -1;
      if (orderB !== undefined) return 1;
      return getConversationPinnedAt(b) - getConversationPinnedAt(a);
    });

  return {
    pinnedConversations,
    timelineSections: groupConversationsByWorkspace(visibleConversations, t),
  };
};
