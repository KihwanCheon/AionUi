export type MobilePushError =
  | 'unsupported'
  | 'identity'
  | 'credentials'
  | 'secureStorage'
  | 'storage'
  | 'disabled'
  | 'device'
  | 'invalidInput'
  | 'rateLimited'
  | 'firebase';

export type MobilePushResult<T> = { ok: true; value: T } | { ok: false; error: MobilePushError };

export type MobilePushDevice = {
  id: string;
  name: string;
  enabled: boolean;
};

export type MobilePushStatus = {
  supported: boolean;
  secureStorageAvailable: boolean;
  enabled: boolean;
  mnpEnabled?: boolean;
  includePreview: boolean;
  configured: boolean;
  credentialPath: string;
  projectId?: string;
  sourceName: string;
  devices: MobilePushDevice[];
  lastSentAt?: number;
  lastError?: MobilePushError;
};

export type MobilePushNotice = {
  key: string;
  kind: 'choice' | 'failure';
  conversationId: string;
  messageId?: string;
  markerIndex?: number;
  preview?: string;
  createdAt: number;
};

export type MobilePushLabels = {
  choiceTitle: string;
  choiceBody: string;
  failureTitle: string;
  failureBody: string;
};

export type MobilePushPairing = { code: string; expiresAt: number };
export type MobilePushOptions = {
  enabled?: boolean;
  mnpEnabled?: boolean;
  includePreview?: boolean;
  sourceName?: string;
};

export type MnpPushNotice = {
  origin: 'mnp';
  key: string;
  eventId: string;
  originId: string;
  kind: 'choice' | 'failure' | 'info';
  title: string;
  body: string;
  createdAt: number;
  revision: number;
  mapId?: string;
  cardId?: string;
  webUrl?: string;
};

export const MOBILE_PUSH_CHANNEL = 'aionui:mobile-push';
export const MOBILE_PUSH_CHANGED = 'aionui:mobile-push-changed';
export type MobilePushOperation = 'status' | 'configure' | 'options' | 'pair' | 'refresh' | 'unlink' | 'test' | 'sync';
export type MobilePushRequest = { operation: MobilePushOperation; data?: unknown };
