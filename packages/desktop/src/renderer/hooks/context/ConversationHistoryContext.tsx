/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConversationListSync } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';
import { useClaudeAutoAllow } from '@/renderer/pages/conversation/platforms/acp/claudePermissions';
import type { GroupedHistoryResult } from '@/renderer/pages/conversation/GroupedHistory/types';
import type { ConversationHistoryView } from '@/renderer/pages/conversation/GroupedHistory/utils/bookmarkHelpers';
import { buildGroupedHistory } from '@/renderer/pages/conversation/GroupedHistory/utils/groupingHelpers';

export type ConversationHistoryContextValue = ReturnType<typeof useConversationListSync> & {
  groupedHistory: GroupedHistoryResult;
  historyView: ConversationHistoryView;
  setHistoryView: React.Dispatch<React.SetStateAction<ConversationHistoryView>>;
};

const ConversationHistoryContext = createContext<ConversationHistoryContextValue | null>(null);

export const ConversationHistoryProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { t } = useTranslation();
  const [historyView, setHistoryView] = useState<ConversationHistoryView>('all');
  const conversationListSync = useConversationListSync();
  useClaudeAutoAllow(conversationListSync.conversations);

  const groupedHistory = useMemo(() => {
    return buildGroupedHistory(conversationListSync.conversations, t);
  }, [conversationListSync.conversations, t]);

  const value = useMemo<ConversationHistoryContextValue>(() => {
    return {
      ...conversationListSync,
      groupedHistory,
      historyView,
      setHistoryView,
    };
  }, [conversationListSync, groupedHistory, historyView]);

  return <ConversationHistoryContext.Provider value={value}>{children}</ConversationHistoryContext.Provider>;
};

export const useConversationHistoryContext = (): ConversationHistoryContextValue => {
  const context = useContext(ConversationHistoryContext);

  if (!context) {
    throw new Error('useConversationHistoryContext must be used within ConversationHistoryProvider');
  }

  return context;
};
