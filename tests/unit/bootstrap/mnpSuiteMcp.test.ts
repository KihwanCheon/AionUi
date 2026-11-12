import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildMindNProgressMcpServer,
  buildMnPSuiteOptionalMcpBootstrap,
  isLegacyMnPSuiteMindNProgressMcpServer,
  isMnPSuiteManagedMcpServer,
} from '@/process/startup/bootstrap/mnpSuiteMcp';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

function makeTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'aionui-mnp-suite-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('buildMindNProgressMcpServer', () => {
  it('builds an enabled managed server for an existing absolute entry', () => {
    const entryPath = path.join(makeTemporaryDirectory(), 'server.mjs');
    writeFileSync(entryPath, '');

    const server = buildMindNProgressMcpServer(entryPath);

    expect(server?.transport).toEqual({ type: 'stdio', command: 'node', args: [entryPath] });
    expect(server?.enabled).toBe(true);
    expect(isMnPSuiteManagedMcpServer(server as never)).toBe(true);
  });

  it('rejects relative and missing entry paths', () => {
    expect(buildMindNProgressMcpServer('mcp/server.mjs')).toBeNull();
    expect(buildMindNProgressMcpServer(path.join(makeTemporaryDirectory(), 'missing.mjs'))).toBeNull();
  });

  it('recognizes the exact unmarked server shape created by older MnP Suite installers', () => {
    const entryPath = path.join(makeTemporaryDirectory(), 'server.mjs');
    const legacyServer = {
      name: 'MindNProgress',
      description: 'Required local MCP server for MindNProgress conversations',
      builtin: false,
      transport: { type: 'stdio' as const, command: 'node', args: [entryPath] },
      original_json: JSON.stringify({
        mcpServers: { MindNProgress: { command: 'node', args: [entryPath] } },
      }),
    };

    expect(isLegacyMnPSuiteMindNProgressMcpServer(legacyServer)).toBe(true);
    expect(
      isLegacyMnPSuiteMindNProgressMcpServer({
        ...legacyServer,
        transport: { type: 'stdio', command: 'custom-node', args: [entryPath] },
      })
    ).toBe(false);
  });
});

describe('buildMnPSuiteOptionalMcpBootstrap', () => {
  it('builds allowlisted optional servers from an existing executable path', () => {
    const directory = makeTemporaryDirectory();
    const commandPath = path.join(directory, 'start-pptx-mcp.sh');
    const configPath = path.join(directory, 'mcp-bootstrap.json');
    writeFileSync(commandPath, '');
    writeFileSync(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        managedBy: 'MnPSuite',
        servers: [{ name: 'pptx-mcp', command: commandPath, args: ['--stdio'] }],
      })
    );

    const bootstrap = buildMnPSuiteOptionalMcpBootstrap(configPath);

    expect(bootstrap?.managedNames).toEqual(['dooray-mcp', 'pptx-mcp']);
    expect(bootstrap?.servers[0]?.transport).toEqual({
      type: 'stdio',
      command: commandPath,
      args: ['--stdio'],
    });
  });

  it('rejects malformed, duplicate, and non-allowlisted descriptors', () => {
    const directory = makeTemporaryDirectory();
    const commandPath = path.join(directory, 'server.sh');
    const configPath = path.join(directory, 'mcp-bootstrap.json');
    writeFileSync(commandPath, '');
    writeFileSync(
      configPath,
      JSON.stringify({ schemaVersion: 1, managedBy: 'MnPSuite', servers: [{ name: 'other', command: commandPath }] })
    );
    expect(buildMnPSuiteOptionalMcpBootstrap(configPath)).toBeNull();

    writeFileSync(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        managedBy: 'MnPSuite',
        servers: [
          { name: 'pptx-mcp', command: commandPath },
          { name: 'pptx-mcp', command: commandPath },
        ],
      })
    );
    expect(buildMnPSuiteOptionalMcpBootstrap(configPath)).toBeNull();
  });
});
