import { isBackendHttpError } from '@/common/adapter/httpBridge';
import mindNProgressLogo from '@/renderer/assets/logos/brand/mindnprogress.svg';
import { Button, Message, Tooltip } from '@arco-design/web-react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  mindNProgressConversationApi,
  type MindNProgressConversationApi,
  type MindNProgressConversationLinkResponse,
} from './api';
import { useMindNProgressConversationLink } from './useConversationLink';

export * from './api';
export { useMindNProgressConversationLink } from './useConversationLink';

export function getMindNProgressSelectionError(error: unknown, fallback: string): string {
  if (isBackendHttpError(error) && error.backendMessage.trim()) {
    return error.backendMessage;
  }
  return fallback;
}

function buildTooltip(link: MindNProgressConversationLinkResponse, fallback: string): string {
  const documentTitle = link.target?.documentTitle.trim() ?? '';
  const cardTitle = link.target?.cardTitle.trim() ?? '';
  if (documentTitle && cardTitle) return `${documentTitle}: ${cardTitle}`;
  return documentTitle || cardTitle || fallback;
}

const MindNProgressConversationLink: React.FC<{
  conversationId: string;
  api?: MindNProgressConversationApi;
}> = ({ conversationId, api = mindNProgressConversationApi }) => {
  const { t } = useTranslation();
  const { state, selecting, select } = useMindNProgressConversationLink(conversationId, api);
  const label = t('messages.mindnprogress.openLinkedCard');
  const tooltip = useMemo(() => (state.status === 'linked' ? buildTooltip(state.link, label) : label), [label, state]);

  if (state.status !== 'linked') return null;

  const handleClick = async (): Promise<void> => {
    try {
      const response = await select();
      if (response) Message.success(response.message);
    } catch (error) {
      Message.error(getMindNProgressSelectionError(error, t('messages.mindnprogress.selectionFailed')));
    }
  };

  return (
    <Tooltip content={tooltip} position='top'>
      <Button
        aria-label={label}
        className='!h-28px !w-28px flex-shrink-0'
        data-testid='mindnprogress-conversation-link'
        disabled={selecting}
        icon={<img alt='' className='h-16px w-16px' src={mindNProgressLogo} />}
        loading={selecting}
        onClick={() => void handleClick()}
        shape='circle'
        size='mini'
        type='text'
      />
    </Tooltip>
  );
};

export default MindNProgressConversationLink;
