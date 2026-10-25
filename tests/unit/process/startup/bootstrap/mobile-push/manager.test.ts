import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobilePushManager } from '@/process/startup/bootstrap/mobile-push/manager';
import { MobilePushStore } from '@/process/startup/bootstrap/mobile-push/store';
import { MobilePushFault, type LinkedDevice } from '@/process/startup/bootstrap/mobile-push/protocol';
import type { MobilePushNotice } from '@/common/types/platform/mobilePush';

const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ format: 'pem', type: 'pkcs8' })
  .toString();
const key = {
  project_id: 'aion-personal',
  client_email: 'sender@aion-personal.iam.gserviceaccount.com',
  private_key: privateKey,
};
const text = {
  choiceTitle: 'Confirmation',
  choiceBody: 'Open AionUi',
  failureTitle: 'Error',
  failureBody: 'Review AionUi',
};
const device = (id = 'phone-1'): LinkedDevice => ({
  id,
  name: id,
  token: `private-token-${id}`,
  pairingId: 'a'.repeat(43),
  enabled: true,
});
let root: string, store: MobilePushStore, manager: MobilePushManager, now: number;
const api = { devices: vi.fn(), pair: vi.fn(), unlink: vi.fn(), send: vi.fn() };
const owns = vi.fn();
const resolveContentMock = vi.fn();
const protection = {
  available: vi.fn(() => true),
  encrypt: (value: string) => `protected:${Buffer.from(value).toString('base64')}`,
  decrypt: (value: string) => Buffer.from(value.slice(10), 'base64').toString(),
};
const notice = (overrides: Partial<MobilePushNotice> = {}): MobilePushNotice => ({
  key: 'request-1',
  kind: 'choice',
  conversationId: 'chat-1',
  messageId: 'message-1',
  markerIndex: 2,
  createdAt: now,
  preview: 'Private question',
  ...overrides,
});
async function enable(userId = 'owner') {
  await manager.configure(userId, path.join(root, 'key.json'));
  await manager.options(userId, { enabled: true });
}
async function flush() {
  now += 600;
  await manager.flush();
}

beforeEach(() => {
  now = 100_000;
  root = mkdtempSync(path.join(os.tmpdir(), 'aion-mobile-push-'));
  writeFileSync(path.join(root, 'key.json'), JSON.stringify(key));
  store = new MobilePushStore(path.join(root, 'state.json'), path.join(root, 'key.json'), 'Test PC', protection);
  vi.clearAllMocks();
  protection.available.mockReturnValue(true);
  api.devices.mockResolvedValue([device()]);
  api.send.mockResolvedValue(undefined);
  api.unlink.mockResolvedValue(undefined);
  owns.mockResolvedValue(true);
  resolveContentMock.mockResolvedValue({ state: 'ready' });
  manager = new MobilePushManager(store, {
    now: () => now,
    client: () => api,
    ownsConversation: owns,
    resolveNotice: resolveContentMock,
    changed: vi.fn(),
  });
});
afterEach(() => {
  manager.stop();
  for (const file of ['state.json', 'state.json.tmp', 'key.json']) {
    const target = path.join(root, file);
    if (existsSync(target)) unlinkSync(target);
  }
  rmdirSync(root);
});

describe('desktop push opt-in and secret storage', () => {
  it('starts disabled and separates Aion users', async () => {
    expect(manager.status('owner').enabled).toBe(false);
    await enable();
    expect(manager.status('other')).toMatchObject({ enabled: false, configured: false, devices: [] });
    expect(manager.status('owner').enabled).toBe(true);
  });
  it('persists protected credentials without exposing them or device tokens in status', async () => {
    await enable();
    await manager.refresh('owner');
    expect(readFileSync(path.join(root, 'state.json'), 'utf8')).not.toContain(privateKey);
    expect(JSON.stringify(manager.status('owner'))).not.toMatch(/private-token|private_key|ciphertext/);
    expect(store.credential('owner').project_id).toBe('aion-personal');
  });
  it('refuses enabling without credentials or OS protection', async () => {
    await expect(manager.options('owner', { enabled: true })).rejects.toMatchObject({ code: 'credentials' });
    protection.available.mockReturnValue(false);
    await expect(manager.configure('owner', path.join(root, 'key.json'))).rejects.toMatchObject({
      code: 'secureStorage',
    });
  });
  it('rejects malformed settings without enabling delivery', async () => {
    await expect(manager.options('owner', { enabled: 'yes' } as never)).rejects.toMatchObject({ code: 'invalidInput' });
    expect(manager.status('owner').enabled).toBe(false);
  });
});

describe('new attention notifications', () => {
  it('sends generic content by default and preserves the exact message anchor', async () => {
    await enable();
    manager.sync('owner', [notice()], text);
    await flush();
    expect(api.send).toHaveBeenCalledTimes(1);
    expect(api.send.mock.calls[0][1]).toMatchObject({
      body: 'Open AionUi',
      messageId: 'message-1',
      markerIndex: '2',
      type: 'user_choice',
    });
    expect(JSON.stringify(api.send.mock.calls[0])).not.toContain('Private question');
  });
  it('includes preview only after its separate opt-in', async () => {
    await enable();
    await manager.options('owner', { includePreview: true });
    manager.sync('owner', [notice()], text);
    await flush();
    expect(api.send.mock.calls[0][1].body).toBe('Private question');
  });
  it('waits for completion even when a partial preview has already been registered', async () => {
    await enable();
    await manager.options('owner', { includePreview: true });
    resolveContentMock.mockResolvedValue({ state: 'pending' });
    const initial = notice({ preview: '이 수정본을 같은 설정(a62cdd' });
    manager.sync('owner', [initial], text);
    await flush();
    expect(api.send).not.toHaveBeenCalled();
    resolveContentMock.mockResolvedValue({
      state: 'ready',
      detail: '이 수정본을 같은 설정(a62cdd)으로 다시 실행할까요?\n\n- 진행\n- 보류',
    });
    now += 1000;
    await manager.flush();
    expect(api.send).toHaveBeenCalledTimes(1);
    expect(api.send.mock.calls[0][1].body).toContain('- 보류');
  });
  it('silently updates the same request once while ignoring an identical replay', async () => {
    await enable();
    await manager.options('owner', { includePreview: true });
    const initial = notice();
    manager.sync('owner', [initial], text);
    await flush();
    const updated = { ...initial, preview: '완성된 질문과 선택지' };
    manager.sync('owner', [updated], text);
    await flush();
    manager.sync('owner', [updated], text);
    await flush();
    expect(api.send).toHaveBeenCalledTimes(2);
    expect(api.send.mock.calls[1][1]).toMatchObject({
      noticeId: api.send.mock.calls[0][1].noticeId,
      revision: '2',
      silent: 'true',
      body: updated.preview,
    });
  });
  it('cancels pending completion work if the notification is dismissed', async () => {
    await enable();
    resolveContentMock.mockResolvedValue({ state: 'pending' });
    manager.sync('owner', [notice()], text);
    await flush();
    manager.sync('owner', [], text);
    resolveContentMock.mockResolvedValue({ state: 'ready', detail: '완성' });
    now += 2000;
    await manager.flush();
    expect(api.send).not.toHaveBeenCalled();
  });
  it('ignores old history while allowing a new request alongside a zero-date history item', async () => {
    await enable();
    manager.sync(
      'owner',
      [notice({ key: 'old', createdAt: now - 10 }), notice({ key: 'unknown', createdAt: 0 }), notice()],
      text
    );
    await flush();
    expect(api.send).toHaveBeenCalledTimes(1);
  });
  it('does not resend on stream preview changes or snapshot replay', async () => {
    await enable();
    const initial = notice();
    manager.sync('owner', [initial], text);
    await flush();
    manager.sync('owner', [{ ...initial, preview: 'Updated question' }], text);
    await flush();
    expect(api.send).toHaveBeenCalledTimes(1);
  });
  it('uses its persisted delivery ledger after a manager reload', async () => {
    await enable();
    const initial = notice();
    manager.sync('owner', [initial], text);
    await flush();
    manager.stop();
    api.send.mockClear();
    store = new MobilePushStore(path.join(root, 'state.json'), path.join(root, 'key.json'), 'PC', protection);
    manager = new MobilePushManager(store, {
      now: () => now,
      startedAt: 100_000,
      client: () => api,
      ownsConversation: owns,
      changed: vi.fn(),
    });
    manager.sync('owner', [initial], text);
    await flush();
    expect(api.send).not.toHaveBeenCalled();
  });
  it('cancels an unsubmitted notification when it is dismissed', async () => {
    await enable();
    manager.sync('owner', [notice()], text);
    manager.sync('owner', [], text);
    await flush();
    expect(api.send).not.toHaveBeenCalled();
  });
  it('rechecks opt-in after an asynchronous ownership lookup', async () => {
    await enable();
    let release!: (value: boolean) => void;
    owns.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        })
    );
    manager.sync('owner', [notice()], text);
    now += 600;
    const pending = manager.flush();
    await manager.options('owner', { enabled: false });
    release(true);
    await pending;
    expect(api.send).not.toHaveBeenCalled();
  });
  it('does not send a notice for a conversation owned by someone else', async () => {
    await enable();
    owns.mockResolvedValue(false);
    manager.sync('owner', [notice()], text);
    await flush();
    expect(api.send).not.toHaveBeenCalled();
  });
  it('waits for a phone that has notifications enabled', async () => {
    await enable();
    api.devices.mockResolvedValue([{ ...device(), enabled: false }]);
    manager.sync('owner', [notice()], text);
    await flush();
    expect(api.send).not.toHaveBeenCalled();
  });
  it('retries a transient failure without sending again to an already successful phone', async () => {
    await enable();
    api.devices.mockResolvedValue([device('one'), device('two')]);
    let failed = false;
    api.send.mockImplementation(async (target: LinkedDevice) => {
      if (target.id === 'two' && !failed) {
        failed = true;
        throw new MobilePushFault('firebase', true);
      }
    });
    manager.sync('owner', [notice()], text);
    await flush();
    now += 2500;
    await manager.flush();
    expect(api.send.mock.calls.map((call) => call[0].id)).toEqual(['one', 'two', 'two']);
  });
  it('continues to a valid phone after an expired registration token', async () => {
    await enable();
    api.devices.mockResolvedValue([device('expired'), device('active')]);
    api.send.mockImplementation(async (target: LinkedDevice) => {
      if (target.id === 'expired') throw new MobilePushFault('device');
    });
    manager.sync('owner', [notice()], text);
    await flush();
    expect(api.send.mock.calls.map((call) => call[0].id)).toEqual(['expired', 'active']);
  });
  it('does not revive another user queue when a delayed lookup completes', async () => {
    await enable();
    let release!: (value: LinkedDevice[]) => void;
    api.devices.mockImplementation(
      () =>
        new Promise<LinkedDevice[]>((resolve) => {
          release = resolve;
        })
    );
    manager.sync('owner', [notice()], text);
    now += 600;
    const pending = manager.flush();
    await vi.waitFor(() => expect(api.devices).toHaveBeenCalled());
    manager.status('other');
    release([device()]);
    await pending;
    expect(api.send).not.toHaveBeenCalled();
    expect(manager.status('other').devices).toEqual([]);
  });
  it('rejects test pushes while disabled and cannot unlink a foreign device', async () => {
    await expect(manager.test('owner', 'phone', 'test', 'body')).rejects.toMatchObject({ code: 'disabled' });
    await enable();
    await expect(manager.unlink('owner', 'foreign')).rejects.toMatchObject({ code: 'device' });
    expect(api.unlink).not.toHaveBeenCalled();
  });
});
