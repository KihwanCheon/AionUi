import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  currentUser: vi.fn(),
  status: vi.fn(),
  configure: vi.fn(),
  once: vi.fn(),
  store: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { getPath: () => 'C:/app', once: mocks.once },
  ipcMain: { handle: mocks.handle },
  safeStorage: {},
}));
vi.mock('@/common', () => ({ ipcBridge: { auth: { currentUser: { invoke: mocks.currentUser } } } }));
vi.mock('@/process/startup/bootstrap/mobile-push/store', () => ({
  MobilePushStore: class {
    constructor() {
      mocks.store();
    }
  },
}));
vi.mock('@/process/startup/bootstrap/mobile-push/manager', () => ({
  MobilePushManager: class {
    status = mocks.status;
    configure = mocks.configure;
    stop = vi.fn();
  },
}));

const platform = process.platform;
const electron = process.versions.electron;
const mainFrame = { url: 'file:///app/index.html' };
const contents = { mainFrame, isDestroyed: () => false, send: vi.fn() };
let invoke: (event: unknown, input: unknown) => Promise<unknown>;
const event = () => ({ sender: contents, senderFrame: mainFrame });

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  Object.defineProperty(process.versions, 'electron', { value: '40.0.0', configurable: true });
  mainFrame.url = 'file:///app/index.html';
  mocks.currentUser.mockResolvedValue({ id: 'native-user' });
  mocks.status.mockReturnValue({ enabled: false });
  const bridge = await import('@/process/startup/bootstrap/mobile-push');
  bridge.setMobilePushWindow({ webContents: contents, isDestroyed: () => false, once: vi.fn() } as never);
  bridge.initMobilePushProviders();
  invoke = mocks.handle.mock.calls[0][1];
});
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: platform });
  if (electron === undefined) delete process.versions.electron;
  else Object.defineProperty(process.versions, 'electron', { value: electron });
});

describe('private desktop push endpoint', () => {
  it('uses the native authenticated user instead of an asserted renderer user', async () => {
    await invoke(event(), { operation: 'status', data: { userId: 'someone-else' } });
    expect(mocks.status).toHaveBeenCalledWith('native-user');
  });
  it.each(['other-window', 'child-frame', 'remote-origin'])(
    'rejects %s before reading identity or credentials',
    async (kind) => {
      const caller = event();
      if (kind === 'other-window') caller.sender = { ...contents };
      if (kind === 'child-frame') caller.senderFrame = { ...mainFrame };
      if (kind === 'remote-origin') mainFrame.url = 'https://localhost.attacker.example/';
      expect(await invoke(caller, { operation: 'configure', data: { credentialPath: 'C:/key.json' } })).toEqual({
        ok: false,
        error: 'unsupported',
      });
      expect(mocks.currentUser).not.toHaveBeenCalled();
      expect(mocks.store).not.toHaveBeenCalled();
    }
  );
  it('allows the local development renderer', async () => {
    mainFrame.url = 'http://127.0.0.1:5300/';
    expect(await invoke(event(), { operation: 'status' })).toEqual({ ok: true, value: { enabled: false } });
  });
  it('rejects an unavailable backend identity', async () => {
    mocks.currentUser.mockRejectedValue(new Error('private backend details'));
    expect(await invoke(event(), { operation: 'status' })).toEqual({ ok: false, error: 'identity' });
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it('sanitizes thrown errors and rejects unknown operations', async () => {
    mocks.configure.mockRejectedValue(new Error('private key material'));
    expect(await invoke(event(), { operation: 'configure', data: { credentialPath: 'C:/key.json' } })).toEqual({
      ok: false,
      error: 'firebase',
    });
    expect(await invoke(event(), { operation: 'unknown' })).toEqual({ ok: false, error: 'invalidInput' });
  });
});
