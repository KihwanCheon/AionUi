import { composeMessage, type IConfirmation, type IMessageAsk, type TMessage } from '@/common/chat/chatLib';
import { describe, expect, it } from 'vitest';
import { isWaitingConfirmationStreamMessage } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';
import { buildMessageIndex, composeMessageWithIndex } from '@/renderer/pages/conversation/Messages/hooks';
import {
  buildPendingConfirmationMessage,
  hasPermissionMessageForCallId,
  removePermissionMessage,
  reconcilePersistedQuestions,
} from '@/renderer/pages/conversation/Messages/usePendingConfirmationsRecovery';

const confirmation: IConfirmation<string> = {
  id: 'tool-1',
  call_id: 'tool-1',
  title: 'Write file',
  description: 'Write /tmp/current_time.txt',
  command_type: 'edit',
  options: [{ label: 'Allow', value: 'allow_once' }],
};

describe('pending confirmations recovery', () => {
  it('builds a permission message with stable msg_id from confirmation id', () => {
    const message = buildPendingConfirmationMessage('conv-1', confirmation);

    expect(message.type).toBe('permission');
    expect(message.conversation_id).toBe('conv-1');
    expect(message.msg_id).toBe('confirmation:tool-1');
    expect(message.content.call_id).toBe('tool-1');
  });

  it('detects existing permission messages by call_id', () => {
    const list = [buildPendingConfirmationMessage('conv-1', confirmation)];

    expect(hasPermissionMessageForCallId(list, 'tool-1')).toBe(true);
    expect(hasPermissionMessageForCallId(list, 'tool-2')).toBe(false);
  });

  it('removes recovered permission messages by confirmation id or call_id', () => {
    const list = [
      buildPendingConfirmationMessage('conv-1', confirmation),
      { id: 'text-1', type: 'text', conversation_id: 'conv-1', content: { content: 'hello' } },
    ] as TMessage[];

    const result = removePermissionMessage(list, { id: 'tool-1', call_id: 'tool-1' });

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('text');
  });
});

const storedQuestion = (overrides: Partial<IMessageAsk['content']> = {}): IMessageAsk => ({
  id: 'ask-stable',
  msg_id: 'ask-stable',
  conversation_id: 'conv-1',
  type: 'ask',
  position: 'left',
  content: {
    session_id: 'conv-1',
    request_id: 'request-1',
    persisted: true,
    questions: [{ question: '진행할까요?', options: [{ label: '진행' }] }],
    ...overrides,
  },
});

describe('persisted native question recovery', () => {
  it('does not relight the sidebar waiting state for an accepted answer update', () => {
    expect(isWaitingConfirmationStreamMessage('ask')).toBe(true);
    expect(isWaitingConfirmationStreamMessage('ask', { resolution: 'answered' })).toBe(false);
    expect(isWaitingConfirmationStreamMessage('permission')).toBe(true);
  });
  it('retains the durable navigation anchor when the confirmation is removed', () => {
    const result = removePermissionMessage([storedQuestion()], { id: 'request-1' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ask-stable');
    expect((result[0] as IMessageAsk).content.resolution).toBe('closed');
  });

  it('preserves an accepted answer when removing a recovered confirmation', () => {
    const message = storedQuestion({ resolution: 'answered' });
    const result = removePermissionMessage([message], { call_id: 'request-1' });
    expect((result[0] as IMessageAsk).content.resolution).toBe('answered');
  });

  it('only enables a restored question after its pending request is confirmed', () => {
    const result = reconcilePersistedQuestions([storedQuestion()], new Set(['request-1']));
    expect((result[0] as IMessageAsk).content.pendingVerified).toBe(true);
    expect((result[0] as IMessageAsk).content.resolution).toBeUndefined();
  });

  it('closes stale restored questions while preserving their content and navigation identity', () => {
    const message = storedQuestion();
    const result = reconcilePersistedQuestions([message], new Set());
    expect(result[0].msg_id).toBe(message.msg_id);
    expect((result[0] as IMessageAsk).content.questions).toEqual(message.content.questions);
    expect((result[0] as IMessageAsk).content.resolution).toBe('closed');
  });

  it('replaces a transient recovery card with its durable card and applies later responses once', () => {
    const transient = {
      ...storedQuestion({ persisted: false }),
      id: 'confirmation:request-1',
      msg_id: 'confirmation:request-1',
    };
    const list = composeMessage(storedQuestion(), [transient]);
    const updated = composeMessage(storedQuestion({ resolution: 'answered' }), list);
    expect(updated).toHaveLength(1);
    expect(updated[0].msg_id).toBe('ask-stable');
    expect((updated[0] as IMessageAsk).content.resolution).toBe('answered');
  });

  it('keeps indexed streaming and restored cards on the same request identity', () => {
    const transient = {
      ...storedQuestion({ persisted: false }),
      id: 'confirmation:request-1',
      msg_id: 'confirmation:request-1',
    };
    const index = buildMessageIndex([transient]);
    const list = composeMessageWithIndex(storedQuestion(), [transient], index);
    const updated = composeMessageWithIndex(storedQuestion({ resolution: 'declined' }), list, index);
    expect(updated).toHaveLength(1);
    expect((updated[0] as IMessageAsk).content.resolution).toBe('declined');
  });
});
