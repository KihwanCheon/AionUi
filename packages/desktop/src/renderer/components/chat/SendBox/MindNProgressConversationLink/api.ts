import { httpRequest } from '@/common/adapter/httpBridge';

export type MindNProgressTarget = {
  mapId: string;
  documentTitle: string;
  cardId: string;
  cardTitle: string;
  archived: boolean;
  titlePrefix?: string;
  cardRole?: 'group-coordinator' | 'document-root' | 'card';
  conversationRole?: 'primary' | 'auxiliary';
  primaryConversationId?: string | null;
  group?: {
    id: string;
    title: string;
    role: 'coordinator';
  };
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
      `/api/integrations/mindnprogress/conversations/${encodeURIComponent(conversationId)}`,
      undefined,
      { timeoutMs: 10000 }
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
