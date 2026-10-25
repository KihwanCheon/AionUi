import type { TMessage } from '@/common/chat/chatLib';
import type { MobilePushNotice } from '@/common/types/platform/mobilePush';
import { noticeContent, type NoticeContent } from '@/common/platform/mobilePush/noticeContent';
import { MobilePushFault, record } from './protocol';

type Reader = (conversationId: string, messageId: string) => Promise<TMessage>;

/** A missing streaming row is retried; completed/structured rows provide their authoritative body. */
export async function resolveNoticeContent(notice: MobilePushNotice, read: Reader): Promise<NoticeContent> {
  if (notice.kind === 'failure') return { state: 'ready', detail: notice.preview };
  if (!notice.messageId) return { state: 'ignored' };
  try {
    return noticeContent(notice, await read(notice.conversationId, notice.messageId));
  } catch (error) {
    if (record(error).status === 404) return { state: 'pending' };
    if (record(error).status === 403) return { state: 'ignored' };
    throw new MobilePushFault('firebase', true);
  }
}
