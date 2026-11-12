import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { MNP_PUSH_PATH } from './mnpPush';
import { MobilePushFault, record } from './protocol';

/** Resolve the user-local discovery file shared with native MnP clients. */
export const pushRelayFile = (): string =>
  process.env.AIONUI_PUSH_RELAY_FILE ||
  path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'AionUiPush', 'mobile-push-relay.json');

/** Native clients discover a loopback endpoint; Firebase credentials never leave the main process. */
export async function startPushRelay(send: (body: unknown) => Promise<unknown>, file = pushRelayFile()) {
  const token = randomBytes(32).toString('base64url');
  const instanceId = randomBytes(16).toString('hex');
  const server = createServer((request, response) => {
    const reply = (status: number, body: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(body));
    };
    void (async () => {
      if (request.method !== 'POST' || request.url !== MNP_PUSH_PATH || request.headers.origin) {
        reply(404, { error: { code: 'unsupported' } });
        return;
      }
      const candidate = Buffer.from(String(request.headers.authorization ?? ''));
      const expected = Buffer.from(`Bearer ${token}`);
      if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
        reply(401, { error: { code: 'identity' } });
        return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        size += Buffer.byteLength(chunk);
        if (size > 64_000) throw new MobilePushFault('invalidInput');
        chunks.push(Buffer.from(chunk));
      }
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new MobilePushFault('invalidInput');
      }
      reply(200, await send(body));
    })().catch((error: unknown) => {
      const code = error instanceof MobilePushFault ? error.code : 'firebase';
      reply(code === 'invalidInput' ? 400 : 409, { error: { code } });
    });
  });
  server.requestTimeout = 15_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Push relay address unavailable');
  const temporary = `${file}.${instanceId}.tmp`;
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      temporary,
      JSON.stringify({ schemaVersion: 1, baseUrl: `http://127.0.0.1:${address.port}`, token, instanceId }),
      { mode: 0o600 }
    );
    await rename(temporary, file);
  } catch (error) {
    server.close();
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return {
    async close(): Promise<void> {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        if (record(JSON.parse(await readFile(file, 'utf8'))).instanceId === instanceId) await unlink(file);
      } catch {
        /* A newer app instance may already own the descriptor. */
      }
    },
  };
}

/** Used by the local MnP Runner. This route must never fall through to AionCore HTTP. */
export async function callPushRelay(body: unknown, file = pushRelayFile()) {
  try {
    const descriptor = record(JSON.parse(await readFile(file, 'utf8')));
    const url = new URL(String(descriptor.baseUrl));
    if (
      descriptor.schemaVersion !== 1 ||
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      typeof descriptor.token !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(descriptor.token)
    )
      throw new Error('descriptor');
    const response = await fetch(`${url.origin}${MNP_PUSH_PATH}`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${descriptor.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result: unknown = await response.json();
    return response.ok
      ? { ok: true, data: result }
      : { ok: false, status: response.status, code: String(record(record(result).error).code || 'firebase') };
  } catch {
    return { ok: false, status: null, code: 'PUSH_RELAY_UNAVAILABLE' };
  }
}
