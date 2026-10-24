import { createHash, createPrivateKey } from 'node:crypto';
import type { MobilePushError, MobilePushLabels, MobilePushNotice } from '@/common/types/platform/mobilePush';

export class MobilePushFault extends Error {
  constructor(
    public readonly code: MobilePushError,
    public readonly retryable = false
  ) {
    super(code);
  }
}

export type FirebaseCredential = { project_id: string; client_email: string; private_key: string };
export type LinkedDevice = {
  id: string;
  name: string;
  enabled: boolean;
  token: string;
  pairingId: string;
  updateTime?: string;
};
export type FcmData = Record<string, string>;
export const MAX_AGE_MS = 15 * 60_000;

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function credential(value: unknown): FirebaseCredential {
  const item = record(value);
  if (
    typeof item.project_id !== 'string' ||
    !/^[a-z][a-z0-9-]{4,62}$/.test(item.project_id) ||
    typeof item.client_email !== 'string' ||
    !/^[^\s@]+@[^\s@]+\.gserviceaccount\.com$/.test(item.client_email) ||
    typeof item.private_key !== 'string' ||
    item.private_key.length > 16000
  )
    throw new MobilePushFault('credentials');
  try {
    if (createPrivateKey(item.private_key).asymmetricKeyType !== 'rsa') throw new Error('rsa');
  } catch {
    throw new MobilePushFault('credentials');
  }
  return { project_id: item.project_id, client_email: item.client_email, private_key: item.private_key };
}

export function validNotice(value: unknown): value is MobilePushNotice {
  const item = record(value);
  return (
    typeof item.key === 'string' &&
    item.key.length > 0 &&
    item.key.length <= 1500 &&
    (item.kind === 'choice' || item.kind === 'failure') &&
    typeof item.conversationId === 'string' &&
    item.conversationId.length > 0 &&
    item.conversationId.length <= 256 &&
    typeof item.createdAt === 'number' &&
    Number.isFinite(item.createdAt) &&
    item.createdAt > 0 &&
    (item.messageId === undefined || (typeof item.messageId === 'string' && item.messageId.length <= 256)) &&
    (item.markerIndex === undefined || (Number.isInteger(item.markerIndex) && Number(item.markerIndex) >= 0)) &&
    (item.preview === undefined || (typeof item.preview === 'string' && item.preview.length <= 5000))
  );
}

export function labels(value: unknown): MobilePushLabels {
  const item = record(value);
  for (const key of ['choiceTitle', 'choiceBody', 'failureTitle', 'failureBody']) {
    if (typeof item[key] !== 'string' || (item[key] as string).length > 500) throw new MobilePushFault('invalidInput');
  }
  return {
    choiceTitle: item.choiceTitle as string,
    choiceBody: item.choiceBody as string,
    failureTitle: item.failureTitle as string,
    failureBody: item.failureBody as string,
  };
}

export function payload(
  sourceId: string,
  notice: MobilePushNotice,
  text: MobilePushLabels,
  includePreview: boolean,
  now: number
): FcmData {
  const failure = notice.kind === 'failure';
  return {
    v: '1',
    type: 'user_choice',
    sourceId,
    noticeId: createHash('sha256').update(notice.key).digest('hex'),
    title: (failure ? text.failureTitle : text.choiceTitle).slice(0, 120),
    body: (includePreview && notice.preview?.trim()
      ? notice.preview.trim()
      : failure
        ? text.failureBody
        : text.choiceBody
    ).slice(0, 320),
    conversationId: notice.conversationId,
    messageId: notice.messageId ?? '',
    markerIndex: String(notice.markerIndex ?? 0),
    createdAt: String(now),
    expiresAt: String(now + MAX_AGE_MS),
  };
}
