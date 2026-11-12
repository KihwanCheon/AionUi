/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';
import { loadAllConversationMessagesPaged } from '@/renderer/utils/chat/messagePagination';

const pendingHistoryReads = new Map<string, Promise<TMessage[]>>();

/** Shares only active history reads so React StrictMode replays do not duplicate them. */
export const loadConversationHistoryOnce = (conversationId: string): Promise<TMessage[]> => {
  const pending = pendingHistoryReads.get(conversationId);
  if (pending) return pending;

  const request = loadAllConversationMessagesPaged(conversationId, { contentMode: 'compact' });
  pendingHistoryReads.set(conversationId, request);
  void request.then(
    () => {
      if (pendingHistoryReads.get(conversationId) === request) pendingHistoryReads.delete(conversationId);
    },
    () => {
      if (pendingHistoryReads.get(conversationId) === request) pendingHistoryReads.delete(conversationId);
    }
  );
  return request;
};
