import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => vi.fn());
vi.mock('@/common/adapter/httpBridge', () => ({ httpRequest: http }));
const api = Object.getOwnPropertyDescriptor(window, 'electronAPI');
beforeEach(() => {
  vi.resetModules();
  http.mockReset();
  Object.defineProperty(window, 'electronAPI', { value: undefined, configurable: true });
});
afterEach(() => {
  if (api) Object.defineProperty(window, 'electronAPI', api);
  else delete window.electronAPI;
});

describe('browser mobile push transport', () => {
  it('loads capability and a CSRF token before changing native options', async () => {
    http.mockResolvedValue({ result: { ok: true, value: { configured: true } }, csrfToken: 'signed-token' });
    const { mobilePushBridge } = await import('@/common/platform/mobilePush');
    expect(mobilePushBridge.available()).toBe(true);
    await mobilePushBridge.options.invoke({ enabled: true });
    expect(http).toHaveBeenLastCalledWith('POST', '/api/mobile-push', {
      csrfToken: 'signed-token',
      request: { operation: 'options', data: { enabled: true } },
    });
  });
  it('keeps file imports and notification enqueueing native-only', async () => {
    const { mobilePushBridge } = await import('@/common/platform/mobilePush');
    expect(await mobilePushBridge.configure.invoke({ credentialPath: 'C:/private/key.json' })).toMatchObject({
      error: 'unsupported',
    });
    expect(http).not.toHaveBeenCalled();
  });
  it('maps an unavailable native host into an explicit unsupported result', async () => {
    http.mockRejectedValue({ status: 404 });
    const { mobilePushBridge } = await import('@/common/platform/mobilePush');
    expect(await mobilePushBridge.status.invoke()).toEqual({ ok: false, error: 'unsupported' });
  });
});
