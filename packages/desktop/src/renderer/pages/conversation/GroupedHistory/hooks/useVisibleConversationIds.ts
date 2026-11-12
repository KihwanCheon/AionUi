import { useMemo } from 'react';
import { useConversationHistoryContext } from '@/renderer/hooks/context/ConversationHistoryContext';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { buildVisibleConversationIds } from '../utils/visibleConversationOrder';
import { useWorkspaceExpansionState } from './useWorkspaceExpansionState';
import { useProjectPins } from '../ProjectPins';

export const useVisibleConversationIds = (): string[] => {
  const layout = useLayoutContext();
  const siderCollapsed = layout?.siderCollapsed ?? false;
  const { groupedHistory, historyView } = useConversationHistoryContext();
  const expandedWorkspaces = useWorkspaceExpansionState();
  const { pinnedWorkspaces } = useProjectPins();

  return useMemo(() => {
    return buildVisibleConversationIds({
      ...groupedHistory,
      expandedWorkspaces,
      historyView,
      siderCollapsed,
      pinnedWorkspaces,
    });
  }, [groupedHistory, expandedWorkspaces, historyView, siderCollapsed, pinnedWorkspaces]);
};
