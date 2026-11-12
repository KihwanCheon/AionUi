import type { MnpPushNotice } from '@/common/types/platform/mobilePush';
import { fitPayloadBody, MAX_AGE_MS, MobilePushFault, record, type FcmData } from './protocol';

export const MNP_PUSH_PATH = '/api/internal/mobile-push/mnp';

/** The producer identity is assigned by the authenticated MnP API, never by its caller. */
export function mnpNotice(value: unknown, now: number): MnpPushNotice {
  const input = record(value);
  for (const key of ['eventId', 'originId']) {
    if (typeof input[key] !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(input[key] as string))
      throw new MobilePushFault('invalidInput');
  }
  if (
    !['choice', 'failure', 'info'].includes(String(input.kind)) ||
    typeof input.title !== 'string' ||
    !input.title.trim() ||
    input.title.length > 120 ||
    typeof input.body !== 'string' ||
    input.body.length > 16000 ||
    !Number.isSafeInteger(input.revision) ||
    Number(input.revision) < 1 ||
    typeof input.createdAt !== 'number' ||
    !Number.isSafeInteger(input.createdAt) ||
    input.createdAt < now - MAX_AGE_MS ||
    input.createdAt > now + 300_000
  )
    throw new MobilePushFault('invalidInput');
  for (const key of ['mapId', 'cardId']) {
    if (
      input[key] !== undefined &&
      (typeof input[key] !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(input[key] as string))
    )
      throw new MobilePushFault('invalidInput');
  }
  let webUrl: string | undefined;
  if (input.webUrl !== undefined) {
    try {
      const url = new URL(String(input.webUrl));
      if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 1500) throw new Error('url');
      webUrl = url.href;
    } catch {
      throw new MobilePushFault('invalidInput');
    }
  }
  return {
    origin: 'mnp',
    key: JSON.stringify(['mnp', input.originId, input.eventId]),
    eventId: input.eventId as string,
    originId: input.originId as string,
    kind: input.kind as MnpPushNotice['kind'],
    title: input.title.trim(),
    body: input.body,
    createdAt: input.createdAt,
    revision: Number(input.revision),
    mapId: input.mapId as string | undefined,
    cardId: input.cardId as string | undefined,
    webUrl,
  };
}

/** Encode the MnP source independently of legacy choice notices, respecting preview consent. */
export function mnpPayload(
  sourceId: string,
  notice: MnpPushNotice,
  preview: boolean,
  now: number,
  noticeId: string
): FcmData {
  return fitPayloadBody(
    {
      v: '2',
      type: 'notice',
      origin: 'mnp',
      kind: notice.kind,
      sourceId,
      noticeId,
      title: preview ? notice.title : '',
      body: '',
      createdAt: String(notice.createdAt),
      expiresAt: String(notice.createdAt + MAX_AGE_MS),
      updatedAt: String(now),
      revision: String(notice.revision),
      silent: String(notice.revision > 1),
      ...(preview && notice.mapId ? { mapId: notice.mapId } : {}),
      ...(preview && notice.cardId ? { cardId: notice.cardId } : {}),
      ...(preview && notice.webUrl ? { webUrl: notice.webUrl } : {}),
    },
    preview ? notice.body : ''
  );
}
