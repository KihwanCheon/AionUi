import type { MindNProgressConversationLinkResponse } from '@/renderer/components/chat/SendBox/MindNProgressConversationLink';

export type LinkStatus = 'linked' | 'unlinked';

/** Only a valid, explicit negative lookup authorizes inclusion in the archive list. */
export function readLinkStatus(conversationId: string, response: MindNProgressConversationLinkResponse): LinkStatus {
  if (response.conversationId !== conversationId) throw new Error('Mismatched MnP conversation lookup');
  if (response.exists === true) return 'linked';
  if (response.exists === false && response.target === null) return 'unlinked';
  throw new Error('Invalid MnP conversation lookup');
}

/** Bound requests to avoid flooding MnP when a workspace contains many conversations. */
export async function forEachConversation(
  ids: string[],
  visit: (id: string) => Promise<void>,
  active: () => boolean
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, ids.length) }, async () => {
      while (active() && next < ids.length) {
        const id = ids[next++];
        // Each worker waits so the total number of active requests stays bounded.
        // eslint-disable-next-line no-await-in-loop
        await visit(id);
      }
    })
  );
}
