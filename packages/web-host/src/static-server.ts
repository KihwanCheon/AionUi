/**
 * WebUI static server.
 *
 * Serves out/renderer/ as the SPA and reverse-proxies /api/*, /ws, /api/stt/stream,
 * /login and /logout to aioncore. All auth goes to backend's aionui-auth crate;
 * /login and /logout are aionui-auth's top-level paths, the rest live under
 * /api/auth/*. /ws and /api/stt/stream are WebSocket/stream upgrades spliced at
 * TCP level; /api/stt/stream is the STT streaming endpoint.
 *
 * Design: Node native http + serve-handler. No Express. No business routes.
 */

import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import net, { type Socket } from 'node:net';
import serveHandler from 'serve-handler';
import {
  createProxyHeaders,
  type TcpConnectionObserver,
  TrustedClientAddressRelay,
} from './trusted-client-address/trustedClientAddress';

export type StaticServerOptions = {
  staticDir: string;
  frontendUrl?: string;
  backendPort: number;
  port?: number;
  allowRemote?: boolean;
};

export type StaticServerHandle = {
  port: number;
  url: string;
  localUrl: string;
  networkUrl?: string;
  lanIP?: string;
  stop: () => Promise<void>;
};

const DEFAULT_PORT = 25808;
const BLOCKED_INTERNAL_API_PREFIXES = [
  '/api/internal/external-conversation-launches',
  '/api/internal/external-conversation-dispatches',
];
const MINDNPROGRESS_NAVIGATION_API_PREFIX = '/api/integrations/mindnprogress/conversations/';

type HttpProxyTarget = {
  hostname: string;
  port: number;
};

// Ranges that are non-internal IPv4 yet never a reachable LAN address, so we
// must never advertise them as the WebUI access URL even when they are the only
// non-loopback interface present:
//   169.254.0.0/16  link-local / APIPA (host got no DHCP lease)
//   198.18.0.0/15   RFC 2544 benchmarking range — handed out by utility tunnels
//                   such as Cloudflare WARP; this is the address that showed up
//                   on a multi-NIC machine instead of the real LAN IP.
const isUnreachableLanRange = (addr: string): boolean => addr.startsWith('169.254.') || /^198\.(18|19)\./.test(addr);

// Rank candidate LAN addresses by how likely they are the network the user
// actually reaches the desktop on. Lower is better. Private (RFC 1918) home /
// office ranges win over anything else; 192.168/16 is the most common LAN, then
// the 172.16/12 block, then 10/8 (frequently carved up by VPNs / corp routing).
const rankLanCandidate = (addr: string): number => {
  if (addr.startsWith('192.168.')) return 0;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) return 1;
  if (addr.startsWith('10.')) return 2;
  return 3;
};

// Pick the best LAN IPv4 to advertise. Pure over the interface map so it can be
// unit-tested against real multi-NIC layouts. Iterating and returning the first
// non-internal hit (the old behavior) picks whatever the OS lists first, which
// on a multi-NIC box can be a VPN / benchmark adapter rather than the LAN.
export function pickLanIP(nets: ReturnType<typeof networkInterfaces>): string | null {
  const candidates: string[] = [];
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name] || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (isUnreachableLanRange(iface.address)) continue;
      candidates.push(iface.address);
    }
  }
  // Stable sort keeps OS interface order among equally-ranked addresses (e.g. a
  // physical NIC listed before a VPN when both are 10/8).
  candidates.sort((a, b) => rankLanCandidate(a) - rankLanCandidate(b));
  return candidates[0] ?? null;
}

function getLanIP(): string | null {
  return pickLanIP(networkInterfaces());
}

function resolveFrontendTarget(frontendUrl?: string): HttpProxyTarget | null {
  if (!frontendUrl) return null;

  const url = new URL(frontendUrl);
  if (url.protocol !== 'http:' || url.username || url.password) {
    throw new Error(`Unsupported WebUI development frontend URL: ${frontendUrl}`);
  }

  const hostname = ['0.0.0.0', '::', '[::]'].includes(url.hostname) ? '127.0.0.1' : url.hostname;
  return {
    hostname,
    port: url.port ? Number(url.port) : 80,
  };
}

function forwardHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  target: HttpProxyTarget,
  path = req.url,
  clientAddress?: string | null
): void {
  const headers = createProxyHeaders(req.headers, `${target.hostname}:${target.port}`, clientAddress);
  const options: http.RequestOptions = {
    hostname: target.hostname,
    port: target.port,
    path,
    method: req.method,
    headers,
  };
  const proxy = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxy.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'BACKEND_UNREACHABLE' }));
    } else {
      res.destroy();
    }
  });
  req.pipe(proxy);
}

function resolveFrontendRequestPath(req: IncomingMessage): string | undefined {
  if (req.method !== 'GET' || !req.url || !req.headers.accept?.includes('text/html')) {
    return req.url;
  }

  const pathname = new URL(req.url, 'http://webui.local').pathname;
  const lastSegment = pathname.split('/').pop() ?? '';
  return pathname !== '/' && !lastSegment.includes('.') ? '/index.html' : req.url;
}

// Max bytes we peek before forcing a routing decision. An HTTP request-line
// on its own is typically < 100 bytes; a full header block is < 2 KB. If we
// haven't seen a newline after 4 KB the client is sending something weird —
// hand it to the internal HTTP server and let it return 400.
const PEEK_LIMIT_BYTES = 4096;

/**
 * Splice `client` to a TCP endpoint at `target`. Any bytes already read
 * from `client` during peek are replayed to the upstream as the first write,
 * so the endpoint sees the full HTTP request as-sent.
 */
function spliceToTcpEndpoint(
  client: Socket,
  target: HttpProxyTarget,
  initialBytes: Buffer,
  connectionObserver?: TcpConnectionObserver
): void {
  client.setNoDelay(true);
  client.setKeepAlive(true);
  client.setTimeout(0);
  // The peek phase left `client` in flowing mode (it had a 'data' listener),
  // but that listener is now removed and the real consumer — `client.pipe(upstream)`
  // — is only wired inside the async 'connect' handler below. Pause here so any
  // body bytes arriving in the gap are buffered by the socket instead of being
  // dropped for lack of a consumer; `pipe()` resumes the socket once connected.
  // Without this, large/buffered uploads (e.g. reverse-proxied POST bodies that
  // span multiple TCP segments) lose their tail bytes and the backend hangs
  // forever waiting for the missing Content-Length (issue #4058).
  client.pause();
  const upstream = net.connect({ host: target.hostname, port: target.port });
  let upstreamLocalPort: number | undefined;
  upstream.setNoDelay(true);
  upstream.setKeepAlive(true);
  upstream.once('connect', () => {
    upstreamLocalPort = upstream.localPort;
    if (upstreamLocalPort !== undefined) connectionObserver?.connected(upstreamLocalPort);
    if (initialBytes.length > 0) upstream.write(initialBytes);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  let closed = false;
  const tearDown = (): void => {
    if (closed) return;
    closed = true;
    if (upstreamLocalPort !== undefined) connectionObserver?.closed(upstreamLocalPort);
    client.destroy();
    upstream.destroy();
  };
  upstream.on('error', tearDown);
  client.on('error', tearDown);
  upstream.on('close', tearDown);
  client.on('close', tearDown);
}

/**
 * Decide routing from the first request headers of an incoming HTTP connection:
 *  - `backend`  → backend WebSocket/stream upgrades
 *  - `frontend` → development frontend WebSocket upgrades (Vite HMR)
 *  - `http`     → internal HTTP server for API proxying or static/frontend HTTP
 *  - `null`     → need more bytes
 *
 * We only check the request-line; `Upgrade: websocket` is not strictly
 * required — the backend will reject a non-upgrade GET on these paths on its own.
 * Keeping the rule simple means we can decide after the first ~50 bytes
 * instead of waiting for the full header block.
 */
type TcpRoute = 'backend' | 'frontend' | 'http';

function peekTcpRoute(buf: Buffer, hasFrontendTarget: boolean): TcpRoute | null {
  const newlineIdx = buf.indexOf(0x0a); // \n
  if (newlineIdx < 0) return null;
  const firstLine = buf.slice(0, newlineIdx).toString('ascii');
  if (/^GET\s+\/(?:ws|api\/stt\/stream)(?:\?[^\s]*)?\s+HTTP\/1\.[01]\r?$/.test(firstLine)) {
    return 'backend';
  }
  if (!hasFrontendTarget) return 'http';

  const headerEnd = buf.indexOf('\r\n\r\n');
  if (headerEnd < 0 && buf.length < PEEK_LIMIT_BYTES) return null;
  const headers = buf.slice(0, headerEnd >= 0 ? headerEnd : undefined).toString('ascii');
  return /(?:^|\r?\n)upgrade:\s*websocket\s*(?:\r?\n|$)/i.test(headers) ? 'frontend' : 'http';
}

export async function startStaticServer(opts: StaticServerOptions): Promise<StaticServerHandle> {
  const port = opts.port ?? DEFAULT_PORT;
  const allowRemote = opts.allowRemote === true;
  const host = allowRemote ? '0.0.0.0' : '127.0.0.1';
  const backendTarget: HttpProxyTarget = { hostname: '127.0.0.1', port: opts.backendPort };
  const frontendTarget = resolveFrontendTarget(opts.frontendUrl);
  const clientAddresses = new TrustedClientAddressRelay();

  // The HTTP server listens only on loopback — user traffic hits the outer
  // net.Server first. We route to this server for everything except WS
  // upgrades and STT stream upgrades, which go straight to the backend via a raw TCP splice.
  //
  // Why two listeners instead of using `http.Server`'s native `upgrade` event:
  // bun 1.3's http-compat layer does not faithfully forward writes on the
  // socket delivered to the `upgrade` handler, so the backend's 101 response
  // never reaches the browser (see #2824). Making the outer listener pure
  // TCP avoids touching that code path on both bun and node.
  const http_server: Server = http.createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        res.writeHead(400).end();
        return;
      }

      const pathname = new URL(req.url, 'http://webui.local').pathname;
      const clientAddress = clientAddresses.resolve(req.socket.remotePort);
      if (BLOCKED_INTERNAL_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'NOT_FOUND' }));
        return;
      }

      // /api/* — reverse proxy to backend (includes /api/auth/*).
      // /login and /logout are aionui-auth's top-level auth endpoints: proxy them too
      // so WebUI browser clients reach the backend without a path-rewrite.
      if (req.url.startsWith('/api/') || req.url.startsWith('/api?') || req.url === '/login' || req.url === '/logout') {
        const navigationClientAddress = pathname.startsWith(MINDNPROGRESS_NAVIGATION_API_PREFIX)
          ? clientAddress
          : undefined;
        forwardHttpRequest(req, res, backendTarget, req.url, navigationClientAddress);
        return;
      }

      if (frontendTarget) {
        forwardHttpRequest(req, res, frontendTarget, resolveFrontendRequestPath(req));
        return;
      }

      // static files + SPA fallback
      await serveHandler(req, res, {
        public: opts.staticDir,
        rewrites: [{ source: '**', destination: '/index.html' }],
      });
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'INTERNAL_ERROR' }));
      } else {
        res.destroy();
      }
    }
  });

  // Internal HTTP server — 127.0.0.1 ephemeral port, never visible to the user.
  await new Promise<void>((resolve, reject) => {
    http_server.once('error', reject);
    http_server.listen(0, '127.0.0.1', () => {
      http_server.off('error', reject);
      resolve();
    });
  });
  const internalPort = (http_server.address() as { port: number } | null)?.port;
  if (!internalPort) {
    throw new Error('internal HTTP server failed to bind to a port');
  }

  // User-facing listener: inspect the first line of every TCP connection and
  // route to either the backend (for /ws and /api/stt/stream upgrades) or the internal HTTP
  // server (everything else). Both routes use raw TCP splice — no reliance
  // on http.Server's upgrade event.
  const tcp_server = net.createServer((client: Socket) => {
    const clientAddress = client.remoteAddress;
    let peeked = Buffer.alloc(0);
    let settled = false;
    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      client.removeListener('data', onData);
      client.removeListener('error', onEarlyError);
      client.removeListener('end', onEarlyEnd);
    };
    const onData = (chunk: Buffer): void => {
      peeked = Buffer.concat([peeked, chunk]);
      const decision = peekTcpRoute(peeked, frontendTarget !== null);
      if (decision === null && peeked.length < PEEK_LIMIT_BYTES) return;
      cleanup();
      const target =
        decision === 'backend'
          ? backendTarget
          : decision === 'frontend' && frontendTarget
            ? frontendTarget
            : { hostname: '127.0.0.1', port: internalPort };
      const throughInternalHttp = decision !== 'backend' && !(decision === 'frontend' && frontendTarget);
      const connectionObserver = throughInternalHttp ? clientAddresses.observe(clientAddress) : undefined;
      spliceToTcpEndpoint(client, target, peeked, connectionObserver);
    };
    const onEarlyError = (): void => {
      cleanup();
      client.destroy();
    };
    const onEarlyEnd = (): void => {
      // Client closed before we saw a request line — nothing to route.
      cleanup();
      client.destroy();
    };
    client.on('data', onData);
    client.on('error', onEarlyError);
    client.on('end', onEarlyEnd);
  });

  await new Promise<void>((resolve, reject) => {
    tcp_server.once('error', reject);
    tcp_server.listen(port, host, () => {
      tcp_server.off('error', reject);
      resolve();
    });
  });

  const actualPort = (tcp_server.address() as { port: number } | null)?.port ?? port;
  const lanIP = allowRemote ? (getLanIP() ?? undefined) : undefined;
  const localUrl = `http://127.0.0.1:${actualPort}`;
  const networkUrl = lanIP ? `http://${lanIP}:${actualPort}` : undefined;

  return {
    port: actualPort,
    url: networkUrl ?? localUrl,
    localUrl,
    networkUrl,
    lanIP,
    stop: () =>
      new Promise<void>((resolve) => {
        tcp_server.close(() => {
          http_server.close(() => resolve());
        });
      }),
  };
}

export async function stopStaticServer(handle: StaticServerHandle): Promise<void> {
  await handle.stop();
}
