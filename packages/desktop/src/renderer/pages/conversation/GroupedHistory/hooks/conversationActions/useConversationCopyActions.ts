/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import { buildConversationExportText, type ExportTranscriptLabels } from '@/renderer/utils/chat/conversationExport';
import { getLastAssistantText } from '@/renderer/utils/chat/getLastAssistantText';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { Message } from '@arco-design/web-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export const useConversationCopyActions = () => {
  const { t } = useTranslation();
  const transcriptLabels = useMemo<ExportTranscriptLabels>(
    () => ({
      conversation: t('messages.export.conversationLabel'),
      conversation_id: t('messages.export.conversationIdLabel'),
      exportedAt: t('messages.export.exportedAtLabel'),
      type: t('messages.export.typeLabel'),
      noMessages: t('messages.export.noMessages'),
      user: t('messages.export.userLabel'),
      assistant: t('messages.export.assistantLabel'),
      system: t('messages.export.systemLabel'),
    }),
    [t]
  );

  const handleCopyLastOutput = useCallback(
    async (conversation: TChatConversation) => {
      try {
        const result = await ipcBridge.database.getConversationMessages.invoke({
          conversation_id: conversation.id,
          limit: 1000,
          content_mode: 'full',
        });
        const text = getLastAssistantText(result.items, false);
        if (!text) {
          Message.warning(t('messages.copyLastOutput.empty'));
          return;
        }
        await copyText(text);
        Message.success(t('messages.copySuccess'));
      } catch (error) {
        console.error('Failed to copy last output:', error);
        Message.error(t('messages.copyFailed'));
      }
    },
    [t]
  );

  const handleCopyAll = useCallback(
    async (conversation: TChatConversation) => {
      try {
        const result = await ipcBridge.database.getConversationMessages.invoke({
          conversation_id: conversation.id,
          limit: 10000,
          content_mode: 'full',
        });
        const transcript = buildConversationExportText(conversation, result.items, transcriptLabels);
        await copyText(transcript);
        Message.success(t('messages.export.copySuccess'));
      } catch (error) {
        console.error('Failed to copy conversation:', error);
        Message.error(t('messages.export.copyFailed'));
      }
    },
    [transcriptLabels, t]
  );

  return { handleCopyLastOutput, handleCopyAll };
};
