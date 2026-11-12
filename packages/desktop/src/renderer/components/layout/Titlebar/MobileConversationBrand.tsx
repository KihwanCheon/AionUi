/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { AgentLogoIcon } from '@/renderer/components/agent/AgentBadge';
import { usePresetAssistantInfo } from '@/renderer/hooks/agent/usePresetAssistantInfo';
import {
  ClaudeAccountBadge,
  resolveConversationClaudeAccount,
  useClaudeAccounts,
} from '@/renderer/pages/conversation/platforms/acp/claudeAccounts';
import { resolveConversationBackend } from '@/renderer/pages/conversation/utils/conversationAssistantIdentity';
import classNames from 'classnames';
import React from 'react';
import useSWR from 'swr';

type MobileConversationBrandProps = {
  conversation_id: string;
  fallbackTitle: string;
};

const MobileConversationBrand: React.FC<MobileConversationBrandProps> = ({ conversation_id, fallbackTitle }) => {
  const { data: conversation } = useSWR(
    conversation_id ? `mobile-titlebar.conversation.${conversation_id}` : null,
    () => ipcBridge.conversation.get.invoke({ id: conversation_id })
  );
  const { info: presetAssistant } = usePresetAssistantInfo(conversation || undefined);
  const backend = resolveConversationBackend(conversation, presetAssistant?.backend);
  const claudeAccounts = useClaudeAccounts();
  const claudeAccount = conversation ? resolveConversationClaudeAccount(claudeAccounts, conversation) : null;

  const showLogo = Boolean(backend || presetAssistant);
  const title = conversation?.name || fallbackTitle;

  return (
    <span className='app-titlebar__brand-mobile'>
      {showLogo && (
        <span
          className={classNames(
            'relative inline-flex items-center justify-center shrink-0',
            claudeAccount && 'size-22px'
          )}
        >
          <AgentLogoIcon
            backend={backend}
            agent_name={title}
            agentLogo={presetAssistant?.logo}
            agentLogoIsEmoji={presetAssistant?.isEmoji}
            agentLogoIsFallback={presetAssistant?.isFallback}
          />
          {claudeAccount && <ClaudeAccountBadge account={claudeAccount} tooltipEnabled={false} />}
        </span>
      )}
      <span className='app-titlebar__brand-text'>{title}</span>
    </span>
  );
};

export default MobileConversationBrand;
