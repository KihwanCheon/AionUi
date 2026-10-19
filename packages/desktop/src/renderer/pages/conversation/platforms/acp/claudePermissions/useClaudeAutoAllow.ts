import { ipcBridge } from '@/common';
import type { IConfirmation } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import { useEffect } from 'react';
import {
  claudeConversationIds,
  forgetClaudeConversation,
  getClaudeMode,
  observeClaudeMode,
  submitClaudePermission,
  subscribeClaudeModes,
} from './state';

/** Only the known one-shot Claude permission values qualify; questions never do. */
export function claudeAllowOption(confirmation: IConfirmation<unknown>): string | undefined {
  if (!confirmation.call_id || confirmation.questions !== undefined || confirmation.title === 'AskUserQuestion') return;
  if (!Array.isArray(confirmation.options)) return;
  const option = confirmation.options.find(
    (candidate) => candidate?.value === 'allow' || candidate?.value === 'allow_once'
  );
  return typeof option?.value === 'string' ? option.value : undefined;
}

function seedConversation(conversation: TChatConversation): void {
  if (
    conversation.type === 'acp' &&
    conversation.extra?.backend === 'claude' &&
    getClaudeMode(conversation.id) === undefined
  ) {
    observeClaudeMode(conversation.id, conversation.extra.session_mode ?? 'default');
  }
}

/** App-wide listener: approval never depends on the conversation page being open. */
export function useClaudeAutoAllow(conversations: TChatConversation[]): void {
  useEffect(() => {
    let disposed = false;
    const fetching = new Set<string>();
    const dirty = new Set<string>();
    const active = (id: string) => !disposed && getClaudeMode(id) === 'bypassPermissions';

    const refresh = async (conversationId: string) => {
      dirty.add(conversationId);
      if (fetching.has(conversationId)) return;
      fetching.add(conversationId);
      try {
        // A background/team conversation may not have reached the sidebar yet.
        if (getClaudeMode(conversationId) === undefined) {
          const conversation = await ipcBridge.conversation.get.invoke({ id: conversationId });
          if (disposed) return;
          if (conversation) seedConversation(conversation);
        }
        while (dirty.delete(conversationId) && active(conversationId)) {
          // Re-query after arrivals during the previous request; never race snapshots.
          // eslint-disable-next-line no-await-in-loop
          const pending = await ipcBridge.conversation.confirmation.list.invoke({ conversation_id: conversationId });
          for (const confirmation of pending ?? []) {
            if (!active(conversationId)) break;
            const value = claudeAllowOption(confirmation);
            if (!value) continue;
            try {
              // Serialize so a changed input mode stops the remaining approvals.
              // eslint-disable-next-line no-await-in-loop
              await submitClaudePermission(
                conversationId,
                confirmation.call_id,
                () =>
                  ipcBridge.conversation.confirmation.confirm.invoke({
                    conversation_id: conversationId,
                    call_id: confirmation.call_id,
                    msg_id: `confirmation:${confirmation.id}`,
                    data: { value },
                    always_allow: false,
                  }),
                true
              );
            } catch {
              // The shared card state exposes the existing retry UI. Do not loop
              // or log tool inputs/commands, and leave retry to the user.
              console.warn('[claude-auto-allow] permission response failed', {
                conversationId,
                callId: confirmation.call_id,
              });
            }
          }
        }
      } catch {
        console.warn('[claude-auto-allow] pending permission lookup failed', { conversationId });
      } finally {
        fetching.delete(conversationId);
        dirty.delete(conversationId);
      }
    };

    const offModes = subscribeClaudeModes((id) => {
      if (active(id)) void refresh(id);
    });
    const offStream = ipcBridge.conversation.responseStream.on((event) => {
      if (event.type === 'acp_permission' && event.conversation_id) void refresh(event.conversation_id);
    });
    const offList = ipcBridge.conversation.listChanged.on((event) => {
      if (event.action === 'deleted') forgetClaudeConversation(event.conversation_id);
    });
    const recover = () =>
      claudeConversationIds().forEach((id) => {
        if (active(id)) void refresh(id);
      });
    window.addEventListener('focus', recover);
    recover();
    return () => {
      disposed = true;
      offModes();
      offStream();
      offList();
      window.removeEventListener('focus', recover);
    };
  }, []);

  useEffect(() => {
    conversations.forEach(seedConversation);
  }, [conversations]);
}
