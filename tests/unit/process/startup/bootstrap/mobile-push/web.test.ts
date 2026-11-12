import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startStaticServer, type StaticServerHandle } from '@aionui/web-host';
import { createMobilePushWebHandler } from '@/process/startup/bootstrap/mobile-push/web';

let backend: Server;
let host: StaticServerHandle;
let now: number;
let authStatus: number;
const invoke = vi.fn(async (_id: string, _request: unknown) => ({
  ok: true as const,
  value: { configured: true, enabled: false },
}));
type Reply = { data: { result: { ok: boolean; error?: string }; csrfToken: string } };
const headers = (account = 'a') => ({ Cookie: `session=${account}`, Connection: 'close' });
const status = async (account = 'a') => {
  const result = await fetch(host.localUrl + '/api/mobile-push', { headers: headers(account) });
  return { status: result.status, body: (await result.json()) as Reply };
};
const post = async (csrfToken: string, operation: string, data: unknown = {}, account = 'a') => {
  const result = await fetch(host.localUrl + '/api/mobile-push', {
    method: 'POST',
    headers: { ...headers(account), 'Content-Type': 'application/json' },
    body: JSON.stringify({ csrfToken, request: { operation, data } }),
  });
  return { status: result.status, body: (await result.json()) as Reply };
};

beforeEach(async () => {
  now = 1_800_000_000_000;
  authStatus = 200;
  invoke.mockClear();
  backend = createServer((request, response) => {
    const account = /session=([ab])/.exec(request.headers.cookie || '')?.[1];
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/auth/user') {
      response.writeHead(account ? authStatus : 401);
      response.end(JSON.stringify(account ? { success: true, user: { id: `login-${account}` } } : { success: false }));
    } else {
      response.end(JSON.stringify({ success: true, data: { id: `scope-${account || 'local'}` } }));
    }
  });
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  host = await startStaticServer({
    staticDir: process.cwd(),
    backendPort: (backend.address() as { port: number }).port,
    port: 0,
    requestHandler: createMobilePushWebHandler(invoke, fetch, () => now),
  });
});
afterEach(async () => {
  await host.stop();
  backend.closeAllConnections();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe('authenticated mobile web settings', () => {
  it('preserves authentication rate limiting instead of reporting a logout', async () => {
    authStatus = 429;
    const result = await status();
    expect(result.status).toBe(429);
    expect(result.body.data.result.error).toBe('rateLimited');
    expect(invoke).not.toHaveBeenCalled();
  });
  it('reports backend downtime without treating it as an expired login', async () => {
    authStatus = 503;
    const result = await status();
    expect(result.status).toBe(503);
    expect(result.body.data.result.error).toBe('unsupported');
    expect(invoke).not.toHaveBeenCalled();
  });
  it('requires a browser login even when ordinary local-identity APIs are available', async () => {
    const result = await fetch(host.localUrl + '/api/mobile-push', { headers: { Connection: 'close' } });
    expect(result.status).toBe(401);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('uses backend-scoped identity rather than caller-provided user ids', async () => {
    const initial = await status();
    const result = await post(initial.body.data.csrfToken, 'options', { enabled: true, userId: 'another' });
    expect(result.status).toBe(200);
    expect(invoke).toHaveBeenLastCalledWith('scope-a', {
      operation: 'options',
      data: { enabled: true, userId: 'another' },
    });
  });
  it('rejects absent, expired and cross-account CSRF tokens before invoking native code', async () => {
    const initial = await status();
    invoke.mockClear();
    expect((await post('', 'pair')).status).toBe(403);
    expect((await post(initial.body.data.csrfToken, 'pair', {}, 'b')).status).toBe(403);
    now += 300_001;
    expect((await post(initial.body.data.csrfToken, 'pair')).status).toBe(403);
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each(['configure', 'sync'])('does not expose %s to browsers', async (operation) => {
    const initial = await status();
    invoke.mockClear();
    const result = await post(initial.body.data.csrfToken, operation, { credentialPath: 'C:/private/key.json' });
    expect(result.status).toBe(403);
    expect(result.body.data.result.error).toBe('unsupported');
    expect(invoke).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON and oversized bodies', async () => {
    const send = (body: string) =>
      fetch(host.localUrl + '/api/mobile-push', {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body,
      });
    expect((await send('{')).status).toBe(400);
    expect((await send('x'.repeat(32001))).status).toBe(413);
    expect(invoke).not.toHaveBeenCalled();
  });
});
