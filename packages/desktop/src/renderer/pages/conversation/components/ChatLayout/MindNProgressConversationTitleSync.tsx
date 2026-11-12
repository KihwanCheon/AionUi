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
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const MINDNPROGRESS_WORKFLOW_TITLE_PREFIX = /^\[(?:배치 제안|Dooray 승인|문서 정리|지식정리)\]\s*/;
const MINDNPROGRESS_ROLE_TITLE_PREFIX = /^\[(?:그룹 총괄|상위)\]\s*/;
const GROUP_COORDINATOR_DOCUMENT_SUFFIX = ' · 통합 관리';

export function buildMindNProgressConversationTitle(target: MindNProgressTarget, currentTitle = ''): string {
  // MnP supplies persisted title data, independent of the UI language. Older
  // servers omit titlePrefix, so preserve their existing role prefix.
  // Responsibility is dynamic UI metadata, never part of the persisted name.
  const rolePrefix =
    (target.cardRole === 'group-coordinator'
      ? '[그룹 총괄] '
      : target.cardRole === 'document-root'
        ? '[상위] '
        : target.cardRole === 'card'
          ? ''
          : target.titlePrefix) ??
    currentTitle.match(MINDNPROGRESS_ROLE_TITLE_PREFIX)?.[0] ??
    '';
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

const MindNProgressTitleSyncButton: React.FC<{
  conversationId: string;
  expectedTitle: string;
  disabled: boolean;
  renameConversation: (conversationId: string, title: string) => Promise<boolean>;
}> = ({ conversationId, expectedTitle, disabled, renameConversation }) => {
  const { t } = useTranslation();
  const [syncing, setSyncing] = useState(false);
  const syncPromiseRef = useRef<Promise<boolean> | null>(null);

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
  api = mindNProgressConversationApi,
  renameConversation = renameMindNProgressConversation,
}: {
  conversationId?: string;
  currentTitle?: React.ReactNode;
  disabled: boolean;
  enabled: boolean;
  api?: MindNProgressConversationApi;
  renameConversation?: (conversationId: string, title: string) => Promise<boolean>;
}): { leadingAction: React.ReactNode; titleClassName?: string } {
  const available = Boolean(enabled && conversationId && typeof currentTitle === 'string');
  const { state } = useMindNProgressConversationLink(conversationId ?? '', api, { enabled: available });
  const expectedTitle =
    available && state.status === 'linked' && state.link.conversationId === conversationId && state.link.target
      ? buildMindNProgressConversationTitle(state.link.target, currentTitle as string)
      : '';
  // Derive both indicators from the same snapshot. A cached lookup can already
  // differ on mount; effect-based resets would erase that warning on selection.
  const mismatch = Boolean(expectedTitle && currentTitle !== expectedTitle);

  return {
    leadingAction: mismatch ? (
      <MindNProgressTitleSyncButton
        key={conversationId}
        conversationId={conversationId!}
        expectedTitle={expectedTitle}
        disabled={disabled}
        renameConversation={renameConversation}
      />
    ) : undefined,
    titleClassName: mismatch ? '!text-warning-6' : undefined,
  };
}

const MindNProgressConversationTitleSync: React.FC<{
  conversationId: string;
  currentTitle: string;
  disabled?: boolean;
  api?: MindNProgressConversationApi;
  renameConversation?: (conversationId: string, title: string) => Promise<boolean>;
}> = ({ disabled = false, ...props }) => {
  const { leadingAction } = useMindNProgressConversationTitleSync({ ...props, disabled, enabled: true });
  return <>{leadingAction}</>;
};

export default MindNProgressConversationTitleSync;
