/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { subscriptionUsageBridge } from '@/common/platform/subscriptionUsageBridge';
import { getSubscriptionUsagePublisher } from './subscriptionUsagePublisher';
import { getPtyMonitorService } from './ptyMonitor';

export const initUsageProviders = (): void => {
  const publisher = getSubscriptionUsagePublisher();
  const ptyMonitor = getPtyMonitorService();
  subscriptionUsageBridge.getClaude.provider(async ({ conversationId }) => {
    const conversation = await ipcBridge.conversation.get.invoke({ id: conversationId });
    if (conversation?.type !== 'acp') return null;
    publisher.noteActiveAcpConversation(conversation.id);
    return publisher.readClaudeUsage(conversation.extra.workspace ?? '', {
      conversationId: conversation.id,
      conversationName: conversation.name,
    });
  });
  subscriptionUsageBridge.getCodex.provider(async ({ conversationId }) => {
    const conversation = await ipcBridge.conversation.get.invoke({ id: conversationId });
    if (conversation?.type !== 'acp') return null;
    publisher.noteActiveAcpConversation(conversation.id);
    return publisher.readCodexUsage();
  });
  subscriptionUsageBridge.getPtyMonitor.provider(() => ptyMonitor.refresh());
  publisher.start();
  ptyMonitor.start();
};
