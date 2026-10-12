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
const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};

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

describe('manually dismissed prose notifications', () => {
  it('preserves a marker fragmented across asynchronous user-identity restoration', () => {
    const store = createChoiceNoticeStore();
    store.consume(frame(USER_CHOICE_MARKER.slice(0, 12)));
    store.hydrate(storage(), 'user-a');
    store.consume(frame(`${USER_CHOICE_MARKER.slice(12)}\n재시작해도 될까요?\n`));
    expect(store.getSnapshot()).toHaveLength(1);
  });

  it('preserves early manual dismissal while restoring an older pending record', () => {
    const saved = storage();
    const previous = createChoiceNoticeStore(saved, 'user-a');
    previous.consume(frame(question));
    const current = createChoiceNoticeStore();
    current.consume(frame(question));
    current.dismiss(current.getSnapshot()[0].key);
    current.hydrate(saved, 'user-a');
    expect(current.getSnapshot()).toEqual([]);
    expect(createChoiceNoticeStore(saved, 'user-a').getSnapshot()).toEqual([]);
  });
  it('does not publish or persist normal streaming content', () => {
    const saved = storage();
    const persist = vi.spyOn(saved, 'setItem');
    const store = createChoiceNoticeStore(saved, 'user-a');
    const change = vi.fn();
    store.subscribe(change);
    store.consume(frame('ordinary response'));
    expect(change).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it('accumulates streamed preview text without duplicate registrations', () => {
    const store = createChoiceNoticeStore();
    store.consume(frame(USER_CHOICE_MARKER.slice(0, 12)));
    store.consume(frame(`${USER_CHOICE_MARKER.slice(12)}\n재시작`));
    store.consume(frame('해도 될까요?\n'));
    expect(store.getSnapshot()).toHaveLength(1);
    expect(store.getSnapshot()[0].preview).toBe('재시작해도 될까요?');
  });

  it('does not clear on finishing, answering, opening, or an AI resolution marker', () => {
    const store = createChoiceNoticeStore();
    store.consume(frame(question));
    for (const type of ['finish', 'start', 'user_content', 'error', 'ask', 'permission']) {
      store.consume(frame('answered', { type }));
    }
    store.consume(frame('[[AIONUI_USER_CHOICE_RESOLVED]]\n', { msg_id: 'message-b' }));
    expect(store.getSnapshot()).toHaveLength(1);
  });

  it('keeps dismissed notifications dismissed across snapshots, replay and restart', () => {
    const saved = storage();
    const store = createChoiceNoticeStore(saved, 'user-a');
    store.consume(frame(question));
    store.dismiss(store.getSnapshot()[0].key);
    store.consume(frame(question, { replace: true }));
    const restored = createChoiceNoticeStore(saved, 'user-a');
    restored.consume(frame(question));
    expect(restored.getSnapshot()).toEqual([]);
  });

  it('restores pending notifications but isolates different user storage keys', () => {
    const saved = storage();
    const store = createChoiceNoticeStore(saved, 'user-a');
    store.consume(frame(question));
    expect(createChoiceNoticeStore(saved, 'user-a').getSnapshot()).toHaveLength(1);
    expect(createChoiceNoticeStore(saved, 'user-b').getSnapshot()).toEqual([]);
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

  it('rejects malformed persistence without crashing or reviving arbitrary records', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const saved = storage();
    saved.setItem('user-a', '{broken');
    expect(createChoiceNoticeStore(saved, 'user-a').getSnapshot()).toEqual([]);
    saved.setItem('user-a', JSON.stringify({ pending: [null, {}, { key: 'forged' }], dismissed: 'invalid' }));
    expect(createChoiceNoticeStore(saved, 'user-a').getSnapshot()).toEqual([]);
  });

  it('keeps registration and dismissal working if storage is unavailable', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createChoiceNoticeStore(
      {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota');
        },
      },
      'user-a'
    );
    store.consume(frame(question));
    expect(store.getSnapshot()).toHaveLength(1);
    store.dismiss(store.getSnapshot()[0].key);
    expect(store.getSnapshot()).toEqual([]);
  });
});
