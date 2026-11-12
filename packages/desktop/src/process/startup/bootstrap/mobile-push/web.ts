import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { WebHostRequestHandler } from '@aionui/web-host';
import type { MobilePushResult } from '@/common/types/platform/mobilePush';
import { record } from './protocol';

const ENDPOINT = '/api/mobile-push';
const ALLOWED = new Set(['options', 'pair', 'refresh', 'unlink', 'test']);

/** Authenticates independently of Core's local identity mode and binds mutations to a CSRF nonce. */
export function createMobilePushWebHandler(
  invoke: (userId: string, request: unknown) => Promise<MobilePushResult<unknown>>,
  http: typeof fetch = fetch,
  now: () => number = Date.now
): WebHostRequestHandler {
  const secret = randomBytes(32);
  const requests = new Map<string, { since: number; count: number }>();
  const signature = (identity: string, expiresAt: string) =>
    createHmac('sha256', secret)
      .update(JSON.stringify([identity, expiresAt]))
      .digest('base64url');
  return async (request, response, context) => {
    if (new URL(request.url || '/', 'http://webui.local').pathname !== ENDPOINT) return false;
    const reply = (status: number, body: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(body));
    };
    const fail = (status: number, error: 'identity' | 'unsupported' | 'invalidInput' | 'rateLimited') => {
      reply(status, { success: false, error, data: { result: { ok: false, error } } });
      return true;
    };
    if (!['GET', 'POST'].includes(request.method || '')) return fail(405, 'unsupported');
    try {
      const headers: Record<string, string> = {};
      if (request.headers.cookie) headers.Cookie = request.headers.cookie;
      if (request.headers.authorization) headers.Authorization = request.headers.authorization;
      // Do not copy runtime tokens, user ids, proxy addresses or arbitrary browser headers.
      const read = async (path: string) => {
        const result = await http(`http://127.0.0.1:${context.backendPort}${path}`, {
          headers,
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        });
        return { status: result.status, body: result.ok ? record(await result.json()) : undefined };
      };
      const authenticated = await read('/api/auth/user');
      if (authenticated.status === 429) return fail(429, 'rateLimited');
      if (authenticated.status >= 500) return fail(503, 'unsupported');
      const account = record(authenticated.body?.user);
      if (authenticated.body?.success !== true || typeof account.id !== 'string') return fail(401, 'identity');
      const scoped = await read('/api/system/current-user');
      if (scoped.status === 429) return fail(429, 'rateLimited');
      if (scoped.status >= 500) return fail(503, 'unsupported');
      const user = record(scoped.body?.data);
      if (scoped.body?.success !== true || typeof user.id !== 'string') return fail(401, 'identity');
      const identity = JSON.stringify([account.id, user.id]);
      const timestamp = now();
      for (const [key, value] of requests) if (timestamp - value.since >= 60_000) requests.delete(key);
      const rate = requests.get(identity) ?? { since: timestamp, count: 0 };
      if (++rate.count > 60 || (!requests.has(identity) && requests.size >= 256)) return fail(429, 'rateLimited');
      requests.set(identity, rate);
      let input: unknown = { operation: 'status' };
      if (request.method === 'POST') {
        if (!request.headers['content-type']?.startsWith('application/json')) return fail(415, 'invalidInput');
        if (Number(request.headers['content-length']) > 32000) return fail(413, 'invalidInput');
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          size += Buffer.byteLength(chunk);
          if (size > 32000) return fail(413, 'invalidInput');
          chunks.push(Buffer.from(chunk));
        }
        let body: Record<string, unknown>;
        try {
          body = record(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          return fail(400, 'invalidInput');
        }
        const token = typeof body.csrfToken === 'string' ? body.csrfToken : '';
        const [expiresAt = '', digest = ''] = token.split('.');
        const expected = Buffer.from(signature(identity, expiresAt));
        const candidate = Buffer.from(digest);
        if (
          token.split('.').length !== 2 ||
          !/^\d{13}$/.test(expiresAt) ||
          Number(expiresAt) <= timestamp ||
          Number(expiresAt) > timestamp + 600_000 ||
          candidate.length !== expected.length ||
          !timingSafeEqual(candidate, expected)
        )
          return fail(403, 'identity');
        input = body.request;
        if (!ALLOWED.has(String(record(input).operation))) return fail(403, 'unsupported');
      }
      const result: MobilePushResult<unknown> = await invoke(user.id, input);
      const expiresAt = String(timestamp + 300_000);
      reply(200, { success: true, data: { result, csrfToken: `${expiresAt}.${signature(identity, expiresAt)}` } });
      return true;
    } catch {
      return fail(503, 'unsupported');
    }
  };
}
