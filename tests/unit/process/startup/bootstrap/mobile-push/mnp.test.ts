import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mnpNotice, mnpPayload, MNP_PUSH_PATH } from '@/process/startup/bootstrap/mobile-push/mnpPush';
import { callPushRelay, startPushRelay } from '@/process/startup/bootstrap/mobile-push/relay';
import * as relayClient from '@/process/startup/bootstrap/mobile-push/relay';
import { callLocalAionUi, normalizeRunnerOperationRequest } from '@/process/resources/mindnprogressRunner/runtime';

const now = 1_800_000_000_000;
const input = {
  originId: 'user-1',
  eventId: 'event-1',
  kind: 'info',
  title: '업무 알림',
  body: '전체 내용',
  createdAt: now,
  revision: 1,
};
let relay: Awaited<ReturnType<typeof startPushRelay>> | undefined;
let root: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await relay?.close();
  relay = undefined;
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe('MnP payload contract', () => {
  it('bounds Korean content by UTF-8 payload bytes and preserves the preview choice', () => {
    const notice = mnpNotice({ ...input, body: '질문🙂\n'.repeat(1000) }, now);
    const data = mnpPayload('pc', notice, true, now, 'notice');
    expect(Buffer.byteLength(JSON.stringify(data), 'utf8')).toBeLessThanOrEqual(3800);
    expect(data.body.endsWith('…')).toBe(true);
    expect(mnpPayload('pc', notice, false, now, 'notice').body).toBe('');
  });
  it.each([
    { originId: '../user' },
    { revision: 0 },
    { createdAt: now - 900001 },
    { kind: 'other' },
    { webUrl: 'file:///secret' },
  ])('rejects malformed or expired requests %o', (override) => {
    expect(() => mnpNotice({ ...input, ...override }, now)).toThrow();
  });
});

describe('loopback push relay', () => {
  it('routes the exact Runner push operation to the private relay rather than AionCore', async () => {
    const send = vi.spyOn(relayClient, 'callPushRelay').mockResolvedValue({ ok: true, data: { state: 'queued' } });
    const coreFetch = vi.fn();
    await callLocalAionUi(
      'http://127.0.0.1:9999',
      { pathname: MNP_PUSH_PATH, method: 'POST', body: input, timeoutMs: 1000 },
      coreFetch
    );
    expect(send).toHaveBeenCalledWith(input);
    expect(coreFetch).not.toHaveBeenCalled();
    expect(() => normalizeRunnerOperationRequest({ pathname: MNP_PUSH_PATH + '?other=1', method: 'POST' })).toThrow();
  });
  async function setup() {
    root = await mkdtemp(path.join(os.tmpdir(), 'aion-mnp-relay-'));
    const file = path.join(root, 'relay.json');
    const send = vi.fn(async () => ({ state: 'queued', eventId: input.eventId }));
    relay = await startPushRelay(send, file);
    const descriptor = JSON.parse(await readFile(file, 'utf8')) as { baseUrl: string; token: string };
    return { file, send, ...descriptor };
  }
  it('authenticates native requests and removes only its own descriptor on close', async () => {
    const { file, send } = await setup();
    expect(await callPushRelay(input, file)).toMatchObject({ ok: true, data: { state: 'queued' } });
    expect(send).toHaveBeenCalledWith(input);
    await relay!.close();
    relay = undefined;
    expect((await callPushRelay(input, file)).code).toBe('PUSH_RELAY_UNAVAILABLE');
  });
  it('rejects unauthenticated clients and browser origins without enqueueing a notice', async () => {
    const { baseUrl, token, send } = await setup();
    const denied = await fetch(baseUrl + MNP_PUSH_PATH, { method: 'POST' });
    const browser = await fetch(baseUrl + MNP_PUSH_PATH, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Origin: 'https://example.com' },
    });
    expect([denied.status, browser.status]).toEqual([401, 404]);
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects non-loopback discovery without sending its credential', async () => {
    const { file } = await setup();
    await writeFile(file, JSON.stringify({ schemaVersion: 1, baseUrl: 'https://example.com', token: 'a'.repeat(43) }));
    expect((await callPushRelay(input, file)).code).toBe('PUSH_RELAY_UNAVAILABLE');
  });
});
