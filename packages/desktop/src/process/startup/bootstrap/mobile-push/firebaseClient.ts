import { createSign, randomBytes } from 'node:crypto';
import type { FirebaseCredential, FcmData, LinkedDevice } from './protocol';
import { MobilePushFault, record } from './protocol';

type HttpFetch = typeof globalThis.fetch;

/** Minimal FCM/Firestore client; no Firebase SDK or cloud runtime is required. */
export class FirebasePushClient {
  private accessToken?: { value: string; expiresAt: number };
  private readonly documents: string;

  constructor(
    private readonly key: FirebaseCredential,
    private readonly http: HttpFetch = globalThis.fetch
  ) {
    this.documents = `https://firestore.googleapis.com/v1/projects/${key.project_id}/databases/(default)/documents`;
  }

  private async token(signal: AbortSignal): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) return this.accessToken.value;
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
    const signed = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
      iss: this.key.client_email,
      scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })}`;
    const assertion = `${signed}.${createSign('RSA-SHA256').update(signed).sign(this.key.private_key).toString('base64url')}`;
    const response = await this.http('https://oauth2.googleapis.com/token', {
      method: 'POST',
      redirect: 'error',
      signal,
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    const body = record(await response.json());
    if (!response.ok || typeof body.access_token !== 'string')
      throw new MobilePushFault('firebase', response.status >= 500);
    this.accessToken = { value: body.access_token, expiresAt: Date.now() + 3500_000 };
    return body.access_token;
  }

  private async request(url: string, method: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const deadline = signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
    const token = await this.token(deadline);
    const options: RequestInit = {
      method,
      redirect: 'error',
      signal: deadline,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    };
    if (body !== undefined) options.body = JSON.stringify(body);
    const response = await this.http(url, options);
    const text = await response.text();
    const data: unknown = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const error = record(record(data).error);
      const unregistered =
        Array.isArray(error.details) &&
        error.details.some((detail: unknown) => record(detail).errorCode === 'UNREGISTERED');
      throw new MobilePushFault(
        unregistered ? 'device' : 'firebase',
        response.status === 429 || response.status >= 500
      );
    }
    return data;
  }

  async devices(sourceId: string, signal?: AbortSignal): Promise<LinkedDevice[]> {
    const response = await this.request(
      `${this.documents}:runQuery`,
      'POST',
      {
        structuredQuery: {
          from: [{ collectionId: 'devices' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'sourceId' },
              op: 'EQUAL',
              value: { stringValue: sourceId },
            },
          },
          limit: 30,
        },
      },
      signal
    );
    if (!Array.isArray(response)) throw new MobilePushFault('firebase');
    return response.flatMap((row: unknown): LinkedDevice[] => {
      const doc = record(record(row).document),
        fields = record(doc.fields);
      const id = typeof doc.name === 'string' ? doc.name.split('/').at(-1) : undefined;
      const token = record(fields.fcmToken).stringValue;
      const pairingId = record(fields.pairingId).stringValue;
      if (
        !id ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
        record(fields.sourceId).stringValue !== sourceId ||
        typeof token !== 'string' ||
        typeof pairingId !== 'string' ||
        !/^[A-Za-z0-9_-]{43,128}$/.test(pairingId)
      )
        return [];
      const name = record(fields.deviceName).stringValue;
      return [
        {
          id,
          name: typeof name === 'string' ? name.slice(0, 160) : id,
          token,
          pairingId,
          enabled: record(fields.enabled).booleanValue === true,
          updateTime: typeof doc.updateTime === 'string' ? doc.updateTime : undefined,
        },
      ];
    });
  }

  async pair(sourceId: string, sourceName: string, signal?: AbortSignal): Promise<{ code: string; expiresAt: number }> {
    const pairingId = randomBytes(32).toString('base64url'),
      expiresAt = Date.now() + 600_000;
    await this.request(
      `${this.documents}/pairings/${pairingId}`,
      'PATCH',
      {
        fields: {
          sourceId: { stringValue: sourceId },
          sourceName: { stringValue: sourceName },
          expiresAt: { timestampValue: new Date(expiresAt).toISOString() },
          claimedBy: { nullValue: null },
        },
      },
      signal
    );
    return {
      code: JSON.stringify({ v: 1, type: 'aionui_pairing', projectId: this.key.project_id, pairingId, expiresAt }),
      expiresAt,
    };
  }

  async unlink(device: LinkedDevice, signal?: AbortSignal): Promise<void> {
    if (!device.updateTime) throw new MobilePushFault('device');
    const root = `projects/${this.key.project_id}/databases/(default)/documents`;
    await this.request(
      `${this.documents}:commit`,
      'POST',
      {
        writes: [
          { delete: `${root}/devices/${device.id}`, currentDocument: { updateTime: device.updateTime } },
          { delete: `${root}/pairings/${device.pairingId}` },
        ],
      },
      signal
    );
  }

  async send(device: LinkedDevice, data: FcmData, signal?: AbortSignal): Promise<void> {
    try {
      await this.request(
        `https://fcm.googleapis.com/v1/projects/${this.key.project_id}/messages:send`,
        'POST',
        {
          message: { token: device.token, android: { priority: 'HIGH', ttl: '900s' }, data },
        },
        signal
      );
    } catch (error) {
      if (error instanceof MobilePushFault) throw error;
      throw new MobilePushFault('firebase', true);
    }
  }
}
