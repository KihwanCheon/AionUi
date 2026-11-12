import http, { type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { startStaticServer, type StaticServerHandle } from '../static-server';

describe('trusted client address relay', () => {
  let staticServer: StaticServerHandle | undefined;
  let backend: Server | undefined;

  afterEach(async () => {
    await staticServer?.stop();
    if (backend) await new Promise<void>((resolve) => backend?.close(() => resolve()));
    staticServer = undefined;
    backend = undefined;
  });

  it('replaces a spoofed internal address header with the public client socket address', async () => {
    backend = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          clientAddress: req.headers['x-aionui-client-address'] ?? null,
        })
      );
    });
    await new Promise<void>((resolve) => backend?.listen(0, '127.0.0.1', resolve));
    const backendPort = (backend.address() as { port: number }).port;
    staticServer = await startStaticServer({ staticDir: process.cwd(), backendPort, port: 0 });

    const response = await fetch(`${staticServer.localUrl}/api/integrations/mindnprogress/conversations/test`, {
      headers: {
        'x-aionui-client-address': '203.0.113.10',
      },
    });

    expect(await response.json()).toEqual({
      clientAddress: '127.0.0.1',
    });
  });
});
