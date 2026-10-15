import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import { ChoiceSignalParser, USER_CHOICE_MARKER } from '@/renderer/hooks/context/UserChoiceNotifications/protocol';
import { createChoiceNoticeStore } from '@/renderer/hooks/context/UserChoiceNotifications/store';

const frame = (data: unknown, overrides: Partial<IResponseMessage> = {}): IResponseMessage => ({
  type: 'content',
  conversation_id: 'conversation-a',
  msg_id: 'message-a',
  data,
  ...overrides,
});
const question = `${USER_CHOICE_MARKER}\n재시작해도 될까요?\n`;

afterEach(() => vi.restoreAllMocks());

describe('explicit prose question signal', () => {
  it('recognizes a marker fragmented at every possible stream boundary', () => {
    for (let split = 0; split <= question.length; split++) {
      const parser = new ChoiceSignalParser();
      parser.feed(question.slice(0, split));
      expect(parser.feed(question.slice(split))).toEqual([{ index: 0, preview: '재시작해도 될까요?' }]);
    }
  });

  it('does not notify for ordinary questions without the explicit marker', () => {
    expect(new ChoiceSignalParser().feed('재시작해도 될까요?')).toEqual([]);
  });

  it('ignores quoted, inline, indented-code and fenced-code examples', () => {
    const examples = [
      `> ${question}`,
      `표식 예시: ${question}`,
      `    ${question}`,
      `\t${question}`,
      `\`\`\`text\n${question}\`\`\`\n`,
      `~~~~\n${question}~~~\n${question}~~~~\n`,
      `\`${USER_CHOICE_MARKER}\`\n`,
    ];
    for (const example of examples) expect(new ChoiceSignalParser().feed(example)).toEqual([]);
  });

  it('does not accept a marker until its standalone line is complete', () => {
    const parser = new ChoiceSignalParser();
    expect(parser.feed(USER_CHOICE_MARKER)).toEqual([]);
    expect(parser.feed(' is only an example\n')).toEqual([]);
  });

  it('supports CRLF, multiple independent questions and a bounded preview', () => {
    const parser = new ChoiceSignalParser();
    const signals = parser.feed(
      `${USER_CHOICE_MARKER}\r\n첫 질문?\r\n\r\n${USER_CHOICE_MARKER}\r\n${'가'.repeat(1000)}`
    );
    expect(signals[0]).toEqual({ index: 0, preview: '첫 질문?' });
    expect(signals[1].preview).toHaveLength(320);
  });

  it('recovers after an oversized non-marker line', () => {
    expect(new ChoiceSignalParser().feed(`${'x'.repeat(100000)}\n${question}`)).toEqual([
      { index: 0, preview: '재시작해도 될까요?' },
    ]);
  });
});

describe('prose notification lifecycle', () => {
  it('preserves a fragmented marker while the initial server snapshot merges', () => {
    const store = createChoiceNoticeStore();
    store.consume(frame(USER_CHOICE_MARKER.slice(0, 12)));
    store.mergeAll([]);
    store.consume(frame(`${USER_CHOICE_MARKER.slice(12)}\n재시작해도 될까요?\n`));
    expect(store.getSnapshot()).toHaveLength(1);
  });

  it('does not revive an optimistic dismissal from a stale server snapshot', () => {
    const store = createChoiceNoticeStore();
    store.consume(frame(question));
    const notice = store.getSnapshot()[0];
    store.dismiss(notice.key);
    store.replaceAll([notice]);
    expect(store.getSnapshot()).toEqual([]);
  });

  it('does not publish or synchronize normal streaming content', () => {
    const store = createChoiceNoticeStore();
    const change = vi.fn();
    const upsert = vi.fn();
    store.subscribe(change);
    store.setSyncHandlers({ upsert, dismiss: vi.fn() });
    store.consume(frame('ordinary response'));
    expect(change).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('accumulates streamed preview text without duplicate registrations', () => {
    const store = createChoiceNoticeStore();
    store.consume(frame(USER_CHOICE_MARKER.slice(0, 12)));
    store.consume(frame(`${USER_CHOICE_MARKER.slice(12)}\n재시작`));
    store.consume(frame('해도 될까요?\n'));
    expect(store.getSnapshot()).toHaveLength(1);
    expect(store.getSnapshot()[0].preview).toBe('재시작해도 될까요?');
  });

  it('synchronizes only non-empty question previews', () => {
    const store = createChoiceNoticeStore();
    const upsert = vi.fn();
    store.setSyncHandlers({ upsert, dismiss: vi.fn() });
    store.consume(frame(`${USER_CHOICE_MARKER}\n`));
    expect(upsert).not.toHaveBeenCalled();
    store.consume(frame('  재시작해도   될까요?  \n'));
    expect(upsert).toHaveBeenLastCalledWith(expect.objectContaining({ preview: '재시작해도 될까요?' }));
  });

  it('keeps an unsynchronized local notice across an unrelated server snapshot', () => {
    const store = createChoiceNoticeStore();
    store.setSyncHandlers({ upsert: vi.fn(), dismiss: vi.fn() });
    store.consume(frame(question));
    const notice = store.getSnapshot()[0];

    store.replaceAll([]);
    expect(store.getSnapshot()).toEqual([notice]);

    store.settleUpsert(notice.key, []);
    expect(store.getSnapshot()).toEqual([]);
  });

  it('synchronizes an immediate dismissal with the complete notice', () => {
    const store = createChoiceNoticeStore();
    const dismiss = vi.fn();
    store.setSyncHandlers({ upsert: vi.fn(), dismiss });
    store.consume(frame(question));
    const notice = store.getSnapshot()[0];

    store.dismiss(notice.key);

    expect(dismiss).toHaveBeenCalledWith(notice);
    store.replaceAll([]);
    expect(store.getSnapshot()).toEqual([]);
  });

  it('does not clear on lifecycle frames, opening, or an AI resolution marker', () => {
    const store = createChoiceNoticeStore();
    store.consume(frame(question));
    for (const type of ['finish', 'start', 'error', 'ask', 'permission']) {
      store.consume(frame('answered', { type }));
    }
    store.consume(frame('[[AIONUI_USER_CHOICE_RESOLVED]]\n', { msg_id: 'message-b' }));
    expect(store.getSnapshot()).toHaveLength(1);
  });

  it('coalesces an identical repeated question onto its newest message', () => {
    const store = createChoiceNoticeStore();
    store.consume(frame(question, { created_at: 1 }));
    store.consume(frame(question, { msg_id: 'message-b', created_at: 2 }));
    expect(store.getSnapshot()).toHaveLength(1);
    expect(store.getSnapshot()[0].messageId).toBe('message-b');
  });

  it('keeps different questions from separate messages until explicitly dismissed', () => {
    const store = createChoiceNoticeStore();
    store.consume(frame(question));
    store.consume(frame(`${USER_CHOICE_MARKER}\n배포해도 될까요?\n`, { msg_id: 'message-b' }));
    expect(store.getSnapshot()).toHaveLength(2);
  });

  it('keeps existing choices when user content and later assistant turns arrive', () => {
    const store = createChoiceNoticeStore();
    store.consume(frame(question));
    store.consume(frame(`${USER_CHOICE_MARKER}\n배포해도 될까요?\n`, { msg_id: 'message-b' }));
    store.consume(frame(question, { conversation_id: 'conversation-b' }));
    const pending = [...store.getSnapshot()];

    store.consume(frame('Proceed', { type: 'user_content', position: 'right' }));
    store.consume(frame('Working on it', { msg_id: 'message-c' }));
    store.consume(frame('', { type: 'finish' }));
    store.replaceAll(pending);
    store.consume(frame(question, { replace: true }));
    expect(store.getSnapshot()).toEqual(pending);
  });

  it('keeps dismissed notifications hidden across snapshots and replay', () => {
    const store = createChoiceNoticeStore();
    store.consume(frame(question));
    const notice = store.getSnapshot()[0];
    store.dismiss(notice.key);
    store.replaceAll([notice]);
    store.consume(frame(question, { replace: true }));
    expect(store.getSnapshot()).toEqual([]);
  });

  it('replaces local state with an authoritative server snapshot', () => {
    const source = createChoiceNoticeStore();
    source.consume(frame(question, { conversation_id: 'conversation-b' }));
    const store = createChoiceNoticeStore();
    store.consume(frame(question));
    store.replaceAll(source.getSnapshot());
    expect(store.getSnapshot().map((item) => item.conversationId)).toEqual(['conversation-b']);
  });

  it('dismisses only the selected question, not its conversation siblings', () => {
    const store = createChoiceNoticeStore();
    store.consume(frame(`${question}\n${question}`));
    store.consume(frame(question, { conversation_id: 'conversation-b' }));
    store.dismiss(store.getSnapshot()[0].key);
    expect(store.getSnapshot()).toHaveLength(2);
    expect(new Set(store.getSnapshot().map((item) => item.conversationId)).size).toBe(2);
  });

  it('ignores hidden, user, reasoning, tool and teammate content', () => {
    const store = createChoiceNoticeStore();
    for (const overrides of [
      { hidden: true },
      { position: 'right' as const },
      { type: 'user_content' },
      { type: 'thought' },
      { type: 'thinking' },
      { type: 'tool_call' },
      { data: { content: question, teammateMessage: true } },
    ])
      store.consume(frame(question, overrides));
    expect(store.getSnapshot()).toEqual([]);
  });

  it('accepts the bridge text-content object and replacement snapshot shapes', () => {
    const store = createChoiceNoticeStore();
    store.consume(frame({ content: question }));
    store.consume(frame({ content: question, replace: true }));
    expect(store.getSnapshot()).toHaveLength(1);
  });

  it('rejects malformed server snapshot records', () => {
    const store = createChoiceNoticeStore();
    store.replaceAll([null, {}, { key: 'forged' }] as never[]);
    expect(store.getSnapshot()).toEqual([]);
  });

  it('restores an optimistic dismissal when server synchronization fails', () => {
    const store = createChoiceNoticeStore();
    store.consume(frame(question));
    const key = store.getSnapshot()[0].key;
    store.dismiss(key);
    expect(store.getSnapshot()).toEqual([]);
    store.rollbackDismiss(key);
    expect(store.getSnapshot()).toHaveLength(1);
  });
});
