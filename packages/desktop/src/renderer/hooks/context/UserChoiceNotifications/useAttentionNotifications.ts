import { useMemo } from 'react';
import { useUnreadConversationFailures } from '@renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';
import { useUserChoiceNotifications } from '.';
import type { ChoiceNotice } from './store';

export type AttentionNotice =
  | (ChoiceNotice & { kind: 'choice' })
  | {
      kind: 'failure';
      key: string;
      conversationId: string;
      createdAt: number;
      preview?: string;
    };

/** Combine presentation only; each source retains its own read/dismissal policy. */
export function useAttentionNotifications() {
  const { notices: choices, dismiss: dismissChoice } = useUserChoiceNotifications();
  const { failures, acknowledge } = useUnreadConversationFailures();
  const notices = useMemo<AttentionNotice[]>(
    () => [
      ...choices.map((choice) => ({ ...choice, kind: 'choice' as const })),
      ...[...failures].map(([conversationId, failure]) => ({
        kind: 'failure' as const,
        key: JSON.stringify(['failure', conversationId, failure.turnId]),
        conversationId,
        createdAt: failure.completedAt,
        preview: failure.message,
      })),
    ],
    [choices, failures]
  );
  const dismiss = (notice: AttentionNotice) => {
    if (notice.kind === 'failure') acknowledge(notice.conversationId);
    else dismissChoice(notice.key);
  };
  return { notices, dismiss, acknowledge };
}
