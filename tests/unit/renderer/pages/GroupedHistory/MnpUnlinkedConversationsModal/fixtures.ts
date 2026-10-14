import type { TChatConversation } from '@/common/config/storage';
import type { MindNProgressConversationLinkResponse } from '@/renderer/components/chat/SendBox/MindNProgressConversationLink';

export const conversation = (id: string): TChatConversation =>
  ({ id, name: id, type: 'acp', extra: { workspace: 'D:/project', custom_workspace: true } }) as TChatConversation;

export const link = (conversationId: string, exists = false): MindNProgressConversationLinkResponse => ({
  conversationId,
  exists,
  target: exists
    ? { mapId: 'map', cardId: 'card', documentTitle: 'Document', cardTitle: 'Card', archived: true }
    : null,
  selectionAvailable: false,
  matchingViewCount: 0,
  localSelectionAvailable: false,
  localViewCount: 0,
  message: '',
});

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
