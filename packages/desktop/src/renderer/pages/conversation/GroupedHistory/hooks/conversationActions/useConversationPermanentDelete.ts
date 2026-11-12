/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { HttpRequestTimeoutError, isBackendHttpError } from '@/common/adapter/httpBridge';
import { emitter } from '@/renderer/utils/emitter';
import { Message, Modal } from '@arco-design/web-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

type RemoveConversation = (conversationId: string) => Promise<boolean>;

/** Restores the fork's direct-delete action without changing upstream's archive-first flow. */
export const useConversationPermanentDelete = (removeConversation: RemoveConversation) => {
  const { t } = useTranslation();

  return useCallback(
    (conversation: TChatConversation) => {
      Modal.confirm({
        title: t('conversation.history.permanentDelete'),
        content: t('settings.archived.deleteConfirmContent', { name: conversation.name }),
        okText: t('conversation.history.permanentDelete'),
        cancelText: t('common.cancel'),
        okButtonProps: { status: 'danger' },
        onOk: async () => {
          try {
            const success = await removeConversation(conversation.id);
            if (!success) {
              Message.error(t('conversation.history.deleteFailed'));
              return;
            }

            emitter.emit('chat.history.refresh');
            Message.success(t('conversation.history.deleteSuccess'));
          } catch (error) {
            console.error('Failed to permanently delete conversation:', error);
            emitter.emit('chat.history.refresh');
            const timedOut =
              error instanceof HttpRequestTimeoutError || (isBackendHttpError(error) && error.code === 'TIMEOUT');
            Message.error(t(timedOut ? 'conversation.history.deleteTimedOut' : 'conversation.history.deleteFailed'));
          }
        },
        style: { borderRadius: '12px' },
        alignCenter: true,
        getPopupContainer: () => document.body,
      });
    },
    [removeConversation, t]
  );
};
