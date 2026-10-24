import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { FirebasePushClient } from '@/process/startup/bootstrap/mobile-push/firebaseClient';
import { credential, payload } from '@/process/startup/bootstrap/mobile-push/protocol';

const key = {
  project_id: 'aion-personal',
  client_email: 'sender@aion-personal.iam.gserviceaccount.com',
  private_key: generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ format: 'pem', type: 'pkcs8' })
    .toString(),
};
const linked = {
  id: 'phone',
  name: 'Phone',
  enabled: true,
  token: 'private-fcm-token',
  pairingId: 'a'.repeat(43),
  updateTime: '2026-10-24T00:00:00Z',
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe('Firebase desktop transport', () => {
  it('caches OAuth access and sends a high-priority data-only message', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: 'oauth' }))
      .mockImplementation(async () => json({ name: 'accepted' }));
    const client = new FirebasePushClient(key, http);
    await client.send(linked, { v: '1' });
    await client.send(linked, { v: '1' });
    expect(http).toHaveBeenCalledTimes(3);
    expect(JSON.parse(http.mock.calls[1][1]?.body as string)).toEqual({
      message: { token: linked.token, android: { priority: 'HIGH', ttl: '900s' }, data: { v: '1' } },
    });
    expect(http.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token');
  });
  it('filters registrations by this source and excludes malformed tokens', async () => {
    const document = (source: string, token: unknown) => ({
      document: {
        name: 'projects/p/databases/(default)/documents/devices/phone',
        updateTime: linked.updateTime,
        fields: {
          sourceId: { stringValue: source },
          fcmToken: { stringValue: token },
          pairingId: { stringValue: linked.pairingId },
          enabled: { booleanValue: true },
          deviceName: { stringValue: 'Phone' },
        },
      },
    });
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: 'oauth' }))
      .mockResolvedValueOnce(json([document('ours', 'token'), document('other', 'private'), document('ours', null)]));
    const devices = await new FirebasePushClient(key, http).devices('ours');
    expect(devices).toHaveLength(1);
    expect(JSON.parse(http.mock.calls[1][1]?.body as string).structuredQuery.where.fieldFilter.value).toEqual({
      stringValue: 'ours',
    });
  });
  it('atomically revokes the exact registration and pairing with a version precondition', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: 'oauth' }))
      .mockResolvedValueOnce(json({}));
    await new FirebasePushClient(key, http).unlink(linked);
    expect(http.mock.calls[1][0]).toContain(':commit');
    expect(JSON.parse(http.mock.calls[1][1]?.body as string).writes).toEqual([
      {
        delete: 'projects/aion-personal/databases/(default)/documents/devices/phone',
        currentDocument: { updateTime: linked.updateTime },
      },
      { delete: `projects/aion-personal/databases/(default)/documents/pairings/${linked.pairingId}` },
    ]);
  });
  it('classifies expired tokens without exposing the server error body', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: 'oauth' }))
      .mockResolvedValueOnce(
        json({ error: { details: [{ errorCode: 'UNREGISTERED' }], message: 'sensitive data' } }, 404)
      );
    await expect(new FirebasePushClient(key, http).send(linked, {})).rejects.toMatchObject({
      code: 'device',
      message: 'device',
      retryable: false,
    });
  });
  it('marks server throttling retryable but rejects invalid credentials', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: 'oauth' }))
      .mockResolvedValueOnce(json({}, 429));
    await expect(new FirebasePushClient(key, http).send(linked, {})).rejects.toMatchObject({ retryable: true });
    expect(() => credential({ ...key, private_key: 'not a key' })).toThrow();
  });
  it('keeps stable message identity and hides previews unless opted in', () => {
    const notice = {
      key: 'stable',
      kind: 'choice' as const,
      conversationId: 'chat',
      createdAt: 1,
      preview: 'Private text',
    };
    const labels = { choiceTitle: 'Confirm', choiceBody: 'Open app', failureTitle: 'Error', failureBody: 'Open app' };
    expect(payload('pc', notice, labels, false, 100).body).toBe('Open app');
    expect(payload('pc', notice, labels, true, 200).noticeId).toBe(payload('pc', notice, labels, false, 100).noticeId);
  });
});
