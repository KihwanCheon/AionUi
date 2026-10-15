import type { GroupedHistoryResult } from '../types';
import { collectProjectGroups, orderProjectGroups } from '../ProjectPins/order';
import { groupBookmarkedConversations } from './bookmarkHelpers';

type VisibleConversationOrderInput = GroupedHistoryResult & {
  expandedWorkspaces: string[];
  historyView: 'all' | 'bookmarks';
  siderCollapsed: boolean;
  pinnedWorkspaces?: readonly string[];
};

export const buildVisibleConversationIds = ({
  pinnedConversations,
  timelineSections,
  expandedWorkspaces,
  historyView,
  siderCollapsed,
  pinnedWorkspaces = [],
}: VisibleConversationOrderInput): string[] => {
  if (historyView === 'bookmarks') {
    return orderProjectGroups(
      groupBookmarkedConversations(pinnedConversations, (key) => key),
      pinnedWorkspaces
    ).flatMap((group) => group.conversations.map((conversation) => conversation.id));
  }

  const expandedWorkspaceSet = new Set(expandedWorkspaces);
  const visibleConversationIds: string[] = [];
  for (const group of collectProjectGroups(timelineSections, pinnedWorkspaces)) {
    if (siderCollapsed || expandedWorkspaceSet.has(group.workspace)) {
      visibleConversationIds.push(...group.conversations.map((conversation) => conversation.id));
    }
  }

  timelineSections.forEach((section) => {
    section.items.forEach((item) => {
      if (item.type === 'conversation' && item.conversation) {
        visibleConversationIds.push(item.conversation.id);
      }
    });
  });

  return visibleConversationIds;
};
