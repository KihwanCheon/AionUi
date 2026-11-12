import type { TMessage } from '@/common/chat/chatLib';
import type { MobilePushNotice } from '@/common/types/platform/mobilePush';
import { ChoiceSignalParser } from './choiceProtocol';

export type NoticeContent = { state: 'pending' | 'ready' | 'ignored'; detail?: string; conversationName?: string };

/** Resolve the exact completed question, including paragraphs and options after its marker. */
export function noticeContent(notice: MobilePushNotice, message: TMessage): NoticeContent {
  if (
    message.conversation_id !== notice.conversationId ||
    (message.id !== notice.messageId && message.msg_id !== notice.messageId) ||
    message.hidden ||
    (message.position && message.position !== 'left')
  )
    return { state: 'ignored' };
  const index = notice.markerIndex ?? 0;
  if (message.type === 'ask') {
    if (message.content.resolution) return { state: 'ignored' };
    const question = message.content.questions[index];
    return question
      ? {
          state: 'ready',
          detail: [
            question.question,
            ...question.options.map(
              (option) => `- ${option.label}${option.description ? `: ${option.description}` : ''}`
            ),
          ].join('\n\n'),
        }
      : { state: 'ignored' };
  }
  if (message.type !== 'text' || message.content.teammateMessage) return { state: 'ignored' };
  if (message.content.user_choice) {
    const question = message.content.user_choice;
    return {
      state: 'ready',
      detail: [question.title, ...(question.options ?? []).map((option) => `- ${option}`)].join('\n\n'),
    };
  }
  if (message.status !== 'finish' && message.status !== 'error') return { state: 'pending' };
  const markers: number[] = [];
  const parser = new ChoiceSignalParser((_index, line) => markers.push(line));
  parser.feed(message.content.content);
  parser.finish();
  if (markers[index] === undefined) return { state: 'ignored' };
  return {
    state: 'ready',
    detail: message.content.content
      .split('\n')
      .slice(markers[index], markers[index + 1] === undefined ? undefined : markers[index + 1] - 1)
      .join('\n')
      .trim(),
  };
}
