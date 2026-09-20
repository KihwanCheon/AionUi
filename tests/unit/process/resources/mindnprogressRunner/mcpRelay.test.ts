import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  forwardRunnerMcpRequest,
  startRunnerMcpRelay,
  type RunnerMcpRelayRequest,
} from '@/process/resources/mindnprogressRunner/mcpRelay';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function relayFixture(forward: (request: RunnerMcpRelayRequest) => Promise<Response>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'aionui-mnp-mcp-relay-'));
  temporaryDirectories.push(directory);
  const descriptorFile = path.join(directory, 'relay.json');
  const relay = await startRunnerMcpRelay({ forward, descriptorFile });
  const descriptor = JSON.parse(await readFile(descriptorFile, 'utf8')) as {
    schemaVersion: number;
    baseUrl: string;
    token: string;
    pid: number;
  };
  return { relay, descriptor, descriptorFile };
}

describe('MindNProgress Runner MCP relay', () => {
  it('uses the stored machine credential only on the outbound request to MindNProgress', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    await forwardRunnerMcpRequest(
      { apiBaseUrl: 'http://main.example:4175', machineId: 'macbook', token: 'machine-secret' },
      {
        pathname: '/api/maps',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-mnp-ai-conversation-id': 'conversation_1' },
        body: '{}',
      },
      fetchImpl
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://main.example:4175/api/maps',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-mnp-ai-conversation-id': 'conversation_1',
          Authorization: 'Bearer machine-secret',
          'X-MnP-Runner-MCP-Machine-Id': 'macbook',
        },
        body: '{}',
        redirect: 'error',
      })
    );
  });

  it('publishes a loopback descriptor and forwards only the required MCP headers', async () => {
    const forward = vi.fn(
      async () =>
        new Response(JSON.stringify({ maps: [] }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-MNP-AI-Attribution-Continuation': 'continuation-token',
          },
        })
    );
    const { relay, descriptor, descriptorFile } = await relayFixture(forward);

    try {
      expect(descriptor.schemaVersion).toBe(1);
      expect(descriptor.baseUrl).toBe(relay.baseUrl);
      expect(new URL(descriptor.baseUrl).hostname).toBe('127.0.0.1');
      expect(descriptor.pid).toBe(process.pid);

      const response = await fetch(`${relay.baseUrl}/api/maps?include=summary`, {
        headers: {
          Authorization: `Bearer ${descriptor.token}`,
          'X-MnP-AI-Conversation-Id': 'conversation_1',
          Cookie: 'must-not-be-forwarded',
        },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('x-mnp-ai-attribution-continuation')).toBe('continuation-token');
      expect(forward).toHaveBeenCalledWith({
        pathname: '/api/maps?include=summary',
        method: 'GET',
        headers: {
          accept: '*/*',
          'x-mnp-ai-conversation-id': 'conversation_1',
        },
        body: undefined,
      });
    } finally {
      await relay.close();
    }
    await expect(readFile(descriptorFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects missing local credentials without contacting MindNProgress', async () => {
    const forward = vi.fn(async () => new Response('{}'));
    const { relay } = await relayFixture(forward);
    try {
      const response = await fetch(`${relay.baseUrl}/api/maps`);
      expect(response.status).toBe(401);
      expect(forward).not.toHaveBeenCalled();
    } finally {
      await relay.close();
    }
  });

  it('does not expose non-API paths through the loopback relay', async () => {
    const forward = vi.fn(async () => new Response('{}'));
    const { relay, descriptor } = await relayFixture(forward);
    try {
      const response = await fetch(`${relay.baseUrl}/config`, {
        headers: { Authorization: `Bearer ${descriptor.token}` },
      });
      expect(response.status).toBe(404);
      expect(forward).not.toHaveBeenCalled();
    } finally {
      await relay.close();
    }
  });
});
