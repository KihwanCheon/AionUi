/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Spin, Tooltip } from '@arco-design/web-react';
import { Attention } from '@icon-park/react';
import React, { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

type ConversationLeadingStatusProps = {
  children: ReactNode;
  conversationId: string;
  isGenerating: boolean;
  isWaitingConfirmation: boolean;
  batchMode: boolean;
  hasFailure?: boolean;
  failureMessage?: string;
  /** Expanded indented rows place status in the original bookmark position. */
  useLeadingGutter?: boolean;
};

/** Keep the identity in its 22px slot and place activity in the existing gap on its leading side. */
export default function ConversationLeadingStatus({
  children,
  conversationId,
  isGenerating,
  isWaitingConfirmation,
  batchMode,
  hasFailure = false,
  failureMessage,
  useLeadingGutter = false,
}: ConversationLeadingStatusProps) {
  const { t } = useTranslation();
  return (
    <>
      {children}
      {!batchMode && (isWaitingConfirmation || isGenerating || hasFailure) && (
        <span
          className={`absolute top-1/2 -translate-y-1/2 size-16px flex-center pointer-events-none ${useLeadingGutter ? '-start-26px' : '-start-12px'}`}
          aria-hidden={isWaitingConfirmation || isGenerating ? true : undefined}
        >
          {isWaitingConfirmation ? (
            <Attention
              theme='filled'
              size='16'
              className='line-height-0 flex-shrink-0 text-warning animate-wiggle'
              data-testid={`conversation-waiting-confirmation-${conversationId}`}
            />
          ) : isGenerating ? (
            <Spin size={16} data-testid={`conversation-generating-indicator-${conversationId}`} />
          ) : (
            <Tooltip content={failureMessage || t('conversation.history.responseFailed')} position='right'>
              <span
                role='img'
                aria-label={t('conversation.history.responseFailed')}
                className='pointer-events-auto flex-center'
              >
                <Attention
                  theme='filled'
                  size='16'
                  className='line-height-0 text-danger'
                  data-testid={`conversation-failure-${conversationId}`}
                />
              </span>
            </Tooltip>
          )}
        </span>
      )}
    </>
  );
}
