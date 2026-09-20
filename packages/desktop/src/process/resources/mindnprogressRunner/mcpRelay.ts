/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const DEFAULT_MNP_MCP_RELAY_FILE = path.join(tmpdir(), 'aionui-mindnprogress-mcp-relay.json');

const REQUEST_BODY_LIMIT = 2 * 1024 * 1024;
const RELAY_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'content-type',
  'x-mnp-ai-attribution',
  'x-mnp-ai-editor-id',
  'x-mnp-ai-type',
  'x-mnp-ai-model',
  'x-mnp-ai-map-id',
  'x-mnp-ai-card-id',
  'x-mnp-ai-conversation-id',
  'x-mnp-ai-request-attribution-continuation',
] as const;

export type RunnerMcpRelayRequest = {
  pathname: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
};

export type RunnerMcpRelay = {
  baseUrl: string;
  close: () => Promise<void>;
};

type RelayOptions = {
  forward: (request: RunnerMcpRelayRequest) => Promise<Response>;
  descriptorFile?: string;
};

type RunnerMcpForwardConfig = {
  apiBaseUrl: string;
  machineId: string;
  token: string;
};

function sendJson(response: import('node:http').ServerResponse, status: number, body: unknown): void {
  const content = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(content),
    'Cache-Control': 'no-store',
  });
  response.end(content);
}

function bearerMatches(request: import('node:http').IncomingMessage, expectedToken: string): boolean {
  const authorization = String(request.headers.authorization ?? '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const candidate = Buffer.from(token);
  const expected = Buffer.from(expectedToken);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

async function readBody(request: import('node:http').IncomingMessage): Promise<string | undefined> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const source of request) {
    const chunk = Buffer.isBuffer(source) ? source : Buffer.from(source);
    size += chunk.length;
    if (size > REQUEST_BODY_LIMIT) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  return chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : undefined;
}

function forwardedHeaders(request: import('node:http').IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    FORWARDED_REQUEST_HEADERS.flatMap((name) => {
      const value = request.headers[name];
      return typeof value === 'string' && value ? [[name, value]] : [];
    })
  );
}

async function writeDescriptor(
  descriptorFile: string,
  descriptor: { schemaVersion: number; baseUrl: string; token: string; instanceId: string; pid: number }
): Promise<void> {
  const temporaryFile = `${descriptorFile}.${descriptor.instanceId}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(descriptor)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryFile, descriptorFile);
  await chmod(descriptorFile, 0o600).catch((): void => undefined);
}

async function removeOwnDescriptor(descriptorFile: string, instanceId: string): Promise<void> {
  try {
    const current = JSON.parse(await readFile(descriptorFile, 'utf8')) as { instanceId?: unknown };
    if (current.instanceId === instanceId) await rm(descriptorFile, { force: true });
  } catch {
    // A newer Runner may already own the descriptor, or shutdown may follow a partial startup.
  }
}

export function forwardRunnerMcpRequest(
  config: RunnerMcpForwardConfig,
  relayRequest: RunnerMcpRelayRequest,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  return fetchImpl(`${config.apiBaseUrl}${relayRequest.pathname}`, {
    method: relayRequest.method,
    headers: {
      ...relayRequest.headers,
      Authorization: `Bearer ${config.token}`,
      'X-MnP-Runner-MCP-Machine-Id': config.machineId,
    },
    body: relayRequest.body,
    redirect: 'error',
    signal: AbortSignal.timeout(620_000),
  });
}

// MCP processes cannot safely receive the Runner machine token. This loopback-only relay
// keeps that credential inside the utility process and publishes a short-lived local token
// in a user-only descriptor. MindNProgress remains the authority for API path and account scope.
export async function startRunnerMcpRelay({
  forward,
  descriptorFile = process.env.MNP_RUNNER_MCP_RELAY_FILE?.trim() || DEFAULT_MNP_MCP_RELAY_FILE,
}: RelayOptions): Promise<RunnerMcpRelay> {
  const relayToken = `mnprl_${randomBytes(32).toString('base64url')}`;
  const instanceId = randomBytes(18).toString('base64url');
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const method = String(request.method ?? '').toUpperCase();
      if (!RELAY_METHODS.has(method) || !url.pathname.startsWith('/api/')) {
        sendJson(response, 404, { error: 'Unsupported MindNProgress MCP request.' });
        return;
      }
      if (!bearerMatches(request, relayToken)) {
        sendJson(response, 401, { error: 'MindNProgress MCP relay authentication failed.' });
        return;
      }

      const forwarded = await forward({
        pathname: `${url.pathname}${url.search}`,
        method,
        headers: forwardedHeaders(request),
        body: await readBody(request),
      });
      const responseBody = Buffer.from(await forwarded.arrayBuffer());
      const continuation = forwarded.headers.get('x-mnp-ai-attribution-continuation');
      response.writeHead(forwarded.status, {
        'Content-Type': forwarded.headers.get('content-type') ?? 'application/json; charset=utf-8',
        'Content-Length': responseBody.length,
        'Cache-Control': 'no-store',
        ...(continuation ? { 'X-MNP-AI-Attribution-Continuation': continuation } : {}),
      });
      response.end(responseBody);
    })().catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      const status = Number((error as { status?: unknown })?.status);
      sendJson(response, Number.isInteger(status) && status >= 400 && status < 500 ? status : 502, {
        error: 'Failed to forward the MindNProgress MCP request.',
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Failed to resolve the MindNProgress MCP relay address.');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await writeDescriptor(descriptorFile, {
      schemaVersion: 1,
      baseUrl,
      token: relayToken,
      instanceId,
      pid: process.pid,
    });
  } catch (error) {
    server.close();
    throw error;
  }

  let closed = false;
  return {
    baseUrl,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await removeOwnDescriptor(descriptorFile, instanceId);
    },
  };
}
