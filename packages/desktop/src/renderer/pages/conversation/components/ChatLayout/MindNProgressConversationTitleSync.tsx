import { ipcBridge } from '@/common';
import {
  mindNProgressConversationApi,
  useMindNProgressConversationLink,
  type MindNProgressConversationApi,
  type MindNProgressTarget,
} from '@/renderer/components/chat/SendBox/MindNProgressConversationLink';
import { refreshConversationCache } from '@/renderer/pages/conversation/utils/conversationCache';
import { emitter } from '@/renderer/utils/emitter';
import { Button, Message, Tooltip } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const MINDNPROGRESS_WORKFLOW_TITLE_PREFIX = /^\[(?:배치 제안|Dooray 승인|문서 정리|지식정리)\]\s*/;
const MINDNPROGRESS_ROLE_TITLE_PREFIX = /^\[(?:그룹 총괄|상위)\]\s*/;
const GROUP_COORDINATOR_DOCUMENT_SUFFIX = ' · 통합 관리';

export function buildMindNProgressConversationTitle(target: MindNProgressTarget, currentTitle = ''): string {
  // MnP supplies persisted title data, independent of the UI language. Older
  // servers omit titlePrefix, so preserve their existing role prefix.
  const rolePrefix = target.titlePrefix ?? currentTitle.match(MINDNPROGRESS_ROLE_TITLE_PREFIX)?.[0] ?? '';
  const workflowPrefix = currentTitle.match(MINDNPROGRESS_WORKFLOW_TITLE_PREFIX)?.[0] ?? rolePrefix;
  const documentTitle = target.documentTitle.trim();
  const groupTitle = target.group?.title.trim() ?? '';
  const synchronizedDocumentTitle =
    target.group?.role === 'coordinator' && groupTitle && documentTitle.endsWith(GROUP_COORDINATOR_DOCUMENT_SUFFIX)
      ? `${groupTitle}${GROUP_COORDINATOR_DOCUMENT_SUFFIX}`
      : documentTitle;
  return `${workflowPrefix}${synchronizedDocumentTitle}: ${target.cardTitle.trim()}`
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export async function renameMindNProgressConversation(conversationId: string, title: string): Promise<boolean> {
  const result = await ipcBridge.conversation.update.invoke({
    id: conversationId,
    updates: { name: title },
  });
  const success = Boolean(result);
  if (success) {
    await refreshConversationCache(conversationId);
    emitter.emit('chat.history.refresh');
  }
  return success;
}

const MindNProgressConversationTitleSync: React.FC<{
  conversationId: string;
  currentTitle: string;
  disabled?: boolean;
  onMismatchChange?: (mismatch: boolean) => void;
  api?: MindNProgressConversationApi;
  renameConversation?: (conversationId: string, title: string) => Promise<boolean>;
}> = ({
  conversationId,
  currentTitle,
  disabled = false,
  onMismatchChange,
  api = mindNProgressConversationApi,
  renameConversation = renameMindNProgressConversation,
}) => {
  const { t } = useTranslation();
  const { state } = useMindNProgressConversationLink(conversationId, api);
  const [syncing, setSyncing] = useState(false);
  const syncPromiseRef = useRef<Promise<boolean> | null>(null);
  const expectedTitle =
    state.status === 'linked' && state.link.conversationId === conversationId && state.link.target
      ? buildMindNProgressConversationTitle(state.link.target, currentTitle)
      : '';
  const mismatch = Boolean(expectedTitle && currentTitle !== expectedTitle);

  useEffect(() => {
    onMismatchChange?.(mismatch);
  }, [mismatch, onMismatchChange]);

  useEffect(
    () => () => {
      onMismatchChange?.(false);
    },
    [onMismatchChange]
  );

  if (!mismatch) return null;

  const label = t('messages.mindnprogress.titleSyncTooltip', { title: expectedTitle });

  const handleSync = async (): Promise<void> => {
    if (syncPromiseRef.current) return;

    let promise: Promise<boolean> | null = null;
    setSyncing(true);
    try {
      promise = renameConversation(conversationId, expectedTitle);
      syncPromiseRef.current = promise;
      const success = await promise;
      if (success) {
        Message.success(t('messages.mindnprogress.titleSyncSuccess'));
      } else {
        Message.error(t('messages.mindnprogress.titleSyncFailed'));
      }
    } catch (error) {
      console.error('Failed to sync conversation title with MindNProgress:', error);
      Message.error(t('messages.mindnprogress.titleSyncFailed'));
    } finally {
      if (!promise || syncPromiseRef.current === promise) syncPromiseRef.current = null;
      setSyncing(false);
    }
  };

  return (
    <Tooltip content={label} position='top'>
      <Button
        aria-label={label}
        className='!h-28px !w-28px flex-shrink-0 !text-warning-6'
        data-testid='mindnprogress-title-sync'
        disabled={disabled || syncing}
        icon={<Refresh theme='outline' size='14' />}
        loading={syncing}
        onClick={() => void handleSync()}
        shape='circle'
        size='mini'
        type='text'
      />
    </Tooltip>
  );
};

export function useMindNProgressConversationTitleSync({
  conversationId,
  currentTitle,
  disabled,
  enabled,
}: {
  conversationId?: string;
  currentTitle?: React.ReactNode;
  disabled: boolean;
  enabled: boolean;
}): { leadingAction: React.ReactNode; titleClassName?: string } {
  const [mismatch, setMismatch] = useState(false);
  const available = Boolean(enabled && conversationId && typeof currentTitle === 'string');

  useEffect(() => {
    setMismatch(false);
  }, [available, conversationId]);

  return {
    leadingAction: available ? (
      <MindNProgressConversationTitleSync
        conversationId={conversationId!}
        currentTitle={currentTitle as string}
        disabled={disabled}
        onMismatchChange={setMismatch}
      />
    ) : undefined,
    titleClassName: available && mismatch ? '!text-warning-6' : undefined,
  };
}

export default MindNProgressConversationTitleSync;
