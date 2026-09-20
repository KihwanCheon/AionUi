import { isBackendHttpError, httpRequest } from '@/common/adapter/httpBridge';
import mindNProgressLogo from '@/renderer/assets/logos/brand/mindnprogress.svg';
import { Button, Message, Tooltip } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type MindNProgressTarget = {
  mapId: string;
  documentTitle: string;
  cardId: string;
  cardTitle: string;
  archived: boolean;
};

export type MindNProgressConversationLinkResponse = {
  conversationId: string;
  exists: boolean;
  target: MindNProgressTarget | null;
  selectionAvailable: boolean;
  matchingViewCount: number;
  localSelectionAvailable: boolean;
  localViewCount: number;
  message: string;
};

export type MindNProgressConversationSelectionResponse = {
  selected: boolean;
  conversationId: string;
  target: MindNProgressTarget;
  deliveredClientCount: number;
  requestedAt: string;
  message: string;
};

export type MindNProgressConversationApi = {
  lookup: (conversationId: string) => Promise<MindNProgressConversationLinkResponse>;
  select: (conversationId: string) => Promise<MindNProgressConversationSelectionResponse>;
};

export const mindNProgressConversationApi: MindNProgressConversationApi = {
  lookup: (conversationId) =>
    httpRequest<MindNProgressConversationLinkResponse>(
      'GET',
      `/api/integrations/mindnprogress/conversations/${encodeURIComponent(conversationId)}`
    ),
  select: (conversationId) =>
    httpRequest<MindNProgressConversationSelectionResponse>(
      'POST',
      `/api/integrations/mindnprogress/conversations/${encodeURIComponent(conversationId)}/select`
    ),
};

export type MindNProgressLinkState =
  | { status: 'loading' }
  | { status: 'unlinked' }
  | { status: 'error'; error: unknown }
  | { status: 'linked'; link: MindNProgressConversationLinkResponse };

export function useMindNProgressConversationLink(
  conversationId: string,
  api: MindNProgressConversationApi = mindNProgressConversationApi
): {
  state: MindNProgressLinkState;
  selecting: boolean;
  select: () => Promise<MindNProgressConversationSelectionResponse | undefined>;
} {
  const [state, setState] = useState<MindNProgressLinkState>({ status: 'loading' });
  const [selecting, setSelecting] = useState(false);
  const currentConversationIdRef = useRef(conversationId);
  const selectionRef = useRef<{
    conversationId: string;
    promise: Promise<MindNProgressConversationSelectionResponse>;
  } | null>(null);
  currentConversationIdRef.current = conversationId;

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    setSelecting(false);

    void api.lookup(conversationId).then(
      (response) => {
        if (!active) return;
        setState(response.exists ? { status: 'linked', link: response } : { status: 'unlinked' });
      },
      (error: unknown) => {
        if (!active) return;
        // A transport failure is not the same as a confirmed unlinked conversation.
        // Keep it as a transient state so revisiting the conversation performs a fresh lookup.
        setState({ status: 'error', error });
      }
    );

    return () => {
      active = false;
    };
  }, [api, conversationId]);

  const select = useCallback(async (): Promise<MindNProgressConversationSelectionResponse | undefined> => {
    if (selectionRef.current?.conversationId === conversationId) return undefined;

    const promise = api.select(conversationId);
    selectionRef.current = { conversationId, promise };
    setSelecting(true);
    try {
      const response = await promise;
      return currentConversationIdRef.current === conversationId ? response : undefined;
    } finally {
      if (selectionRef.current?.promise === promise) {
        selectionRef.current = null;
        setSelecting(false);
      }
    }
  }, [api, conversationId]);

  return { state, selecting, select };
}

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
