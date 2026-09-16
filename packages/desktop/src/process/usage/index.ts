/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { subscriptionUsageBridge } from '@/common/platform/subscriptionUsageBridge';
import { getSubscriptionUsagePublisher } from './subscriptionUsagePublisher';

export const initUsageProviders = (): void => {
  const publisher = getSubscriptionUsagePublisher();
  subscriptionUsageBridge.getClaude.provider(async ({ conversationId }) => {
    const conversation = await ipcBridge.conversation.get.invoke({ id: conversationId });
    if (conversation?.type !== 'acp') return null;
    publisher.noteActiveAcpConversation(conversation.id);
    return publisher.readClaudeUsage(conversation.extra.workspace ?? '');
  });
  subscriptionUsageBridge.getCodex.provider(async ({ conversationId }) => {
    if (conversationId) {
      const conversation = await ipcBridge.conversation.get.invoke({ id: conversationId });
      if (conversation?.type !== 'acp') return null;
      publisher.noteActiveAcpConversation(conversation.id);
    }
    return publisher.readCodexUsage();
  });
  publisher.start();
};
