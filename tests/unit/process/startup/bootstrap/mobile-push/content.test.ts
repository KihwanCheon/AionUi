import { describe, expect, it, vi } from 'vitest';
import type { TMessage } from '@/common/chat/chatLib';
import type { MobilePushNotice } from '@/common/types/platform/mobilePush';
import { USER_CHOICE_MARKER as marker } from '@/common/platform/mobilePush/choiceProtocol';
import { noticeContent } from '@/common/platform/mobilePush/noticeContent';
import { resolveNoticeContent } from '@/process/startup/bootstrap/mobile-push/contentResolver';
import { payload, contentFingerprint } from '@/process/startup/bootstrap/mobile-push/protocol';

const notice: MobilePushNotice = {
  key: 'request',
  kind: 'choice',
  conversationId: 'chat',
  messageId: 'message',
  markerIndex: 0,
  createdAt: 100,
};
const message = (text: string, status: 'work' | 'finish' = 'finish'): TMessage => ({
  id: 'message',
  type: 'text',
  conversation_id: 'chat',
  position: 'left',
  content: { content: text },
  status,
});
const text = {
  choiceTitle: '확인 요청',
  choiceBody: 'AionUi에서 확인해 주세요.',
  failureTitle: '오류',
  failureBody: '오류를 확인해 주세요.',
};

describe('completed push question content', () => {
  it('waits while the matching text is still being written', () => {
    expect(noticeContent(notice, message(`${marker}\n이 수정본을 같은 설정(a62cdd`, 'work')).state).toBe('pending');
  });
  it('includes the complete question, options and later paragraphs without the following request', () => {
    const source = `${marker}\n이 수정본을 같은 설정으로 다시 실행할까요?\n\n- 직접 실행\n- 다음에 실행\n\n추가 설명입니다.\n${marker}\n다음 질문`;
    expect(noticeContent(notice, message(source))).toEqual({
      state: 'ready',
      detail: '이 수정본을 같은 설정으로 다시 실행할까요?\n\n- 직접 실행\n- 다음에 실행\n\n추가 설명입니다.',
    });
  });
  it('uses the same marker indices as the UI when code and quotes contain marker examples', () => {
    const source = `> ${marker}\n\n~~~\n${marker}\n~~~\n${marker}\n첫 질문\n${marker}\n둘째 질문`;
    expect(noticeContent({ ...notice, markerIndex: 1 }, message(source)).detail).toBe('둘째 질문');
  });
  it('leaves an empty final marker to the ordinary fallback message', () => {
    expect(noticeContent(notice, message(`앞의 설명\n${marker}`))).toEqual({ state: 'ready', detail: '' });
  });
  it('delivers a structured question without waiting for its blocked turn to finish', () => {
    const ask: TMessage = {
      id: 'message',
      type: 'ask',
      conversation_id: 'chat',
      status: 'work',
      content: {
        session_id: 'chat',
        request_id: 'request',
        questions: [{ question: '진행할까요?', options: [{ label: '진행', description: '검증 후 적용' }] }],
      },
    };
    expect(noticeContent(notice, ask)).toEqual({ state: 'ready', detail: '진행할까요?\n\n- 진행: 검증 후 적용' });
    expect(noticeContent(notice, { ...ask, content: { ...ask.content, resolution: 'answered' } }).state).toBe(
      'ignored'
    );
  });
  it('does not use a hidden, foreign, or mismatched message as the notification body', () => {
    const original = message(`${marker}\n질문`);
    expect(noticeContent(notice, { ...original, conversation_id: 'other' }).state).toBe('ignored');
    expect(noticeContent(notice, { ...original, id: 'other' }).state).toBe('ignored');
    expect(noticeContent(notice, { ...original, hidden: true }).state).toBe('ignored');
  });
  it('retries a not-yet-persisted row but rejects denied access', async () => {
    const read = vi.fn().mockRejectedValue({ status: 404 });
    expect(await resolveNoticeContent(notice, read)).toEqual({ state: 'pending' });
    read.mockRejectedValue({ status: 403 });
    expect(await resolveNoticeContent(notice, read)).toEqual({ state: 'ignored' });
    read.mockRejectedValue(new Error('network'));
    await expect(resolveNoticeContent(notice, read)).rejects.toMatchObject({ retryable: true });
  });
});

describe('full push payload and revisions', () => {
  it('sends more than 320 Korean characters and includes the conversation name only when opted in', () => {
    const input = { ...notice, detail: '완성된 질문입니다. '.repeat(70), conversationName: '검증 대화' };
    const data = payload('pc', input, text, true, 200);
    expect(data.body.length).toBeGreaterThan(320);
    expect(data.title).toContain('검증 대화');
    expect(payload('pc', input, text, false, 200)).toMatchObject({ title: text.choiceTitle, body: text.choiceBody });
  });
  it('keeps escaped multibyte text within the FCM byte budget without breaking emoji', () => {
    const data = payload('pc', { ...notice, detail: '긴 내용 😀\n"설명"\\'.repeat(2000) }, text, true, 200);
    expect(Buffer.byteLength(JSON.stringify(data), 'utf8')).toBeLessThanOrEqual(3800);
    expect(data.body.endsWith('…')).toBe(true);
    expect(data.body).not.toContain('�');
  });
  it('keeps notification identity and content fingerprint stable across revision and transport time changes', () => {
    const first = payload('pc', { ...notice, detail: '질문' }, text, true, 200);
    const next = payload('pc', { ...notice, detail: '질문' }, text, true, 300, 2, true);
    expect(next.noticeId).toBe(first.noticeId);
    expect(contentFingerprint(next)).toBe(contentFingerprint(first));
    expect(next).toMatchObject({ revision: '2', silent: 'true', createdAt: '100' });
  });
});
