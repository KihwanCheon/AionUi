import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IMAGE_GEN_ENV_KEYS } from '@/common/config/imageGenerationMcpEnv';
import { BUILTIN_IMAGE_GEN_NAME, type IMcpServer, type IProvider } from '@/common/config/storage';
import { resolveImageGenerationMigrationConfig, runBackendMigrations } from '@/process/utils/runBackendMigrations';

const {
  batchImportServersMock,
  configFileGetMock,
  configFileSetMock,
  deleteServerMock,
  httpRequestMock,
  listServersMock,
  testMcpConnectionMock,
  toggleServerMock,
  updateServerMock,
} = vi.hoisted(() => ({
  batchImportServersMock: vi.fn(),
  configFileGetMock: vi.fn(),
  configFileSetMock: vi.fn(),
  deleteServerMock: vi.fn(),
  httpRequestMock: vi.fn(),
  listServersMock: vi.fn(),
  testMcpConnectionMock: vi.fn(),
  toggleServerMock: vi.fn(),
  updateServerMock: vi.fn(),
}));

vi.mock('@/common/adapter/httpBridge', () => ({
  httpRequest: httpRequestMock,
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: {
    listServers: { invoke: listServersMock },
    batchImportServers: { invoke: batchImportServersMock },
    deleteServer: { invoke: deleteServerMock },
    toggleServer: { invoke: toggleServerMock },
    updateServer: { invoke: updateServerMock },
    testMcpConnection: { invoke: testMcpConnectionMock },
  },
}));

vi.mock('@/common/config/configMigration', () => ({
  migrateConfigStorage: vi.fn().mockResolvedValue(undefined),
  migrateLegacyMcpConfigToDb: vi.fn().mockResolvedValue(undefined),
  migrateProviders: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/process/utils/initStorage', () => ({
  getBuiltinMcpScriptPath: (name: string) => `/mock/${name}.js`,
}));

vi.mock('@/process/utils/migrateAssistants', () => ({
  migrateAssistantsToBackend: vi.fn().mockResolvedValue(true),
}));

const provider: IProvider = {
  id: 'provider-1',
  platform: 'gemini',
  name: 'Gemini',
  base_url: 'https://generativelanguage.googleapis.com',
  api_key: 'provider-key',
  models: ['gemini-image'],
  enabled: true,
};

const imageEnv = {
  [IMAGE_GEN_ENV_KEYS.providerId]: 'provider-1',
  [IMAGE_GEN_ENV_KEYS.platform]: 'gemini',
  [IMAGE_GEN_ENV_KEYS.baseUrl]: 'https://generativelanguage.googleapis.com',
  [IMAGE_GEN_ENV_KEYS.apiKey]: 'provider-key',
  [IMAGE_GEN_ENV_KEYS.model]: 'gemini-image',
};

const imageServer = (): IMcpServer => ({
  id: 'image-server-id',
  name: BUILTIN_IMAGE_GEN_NAME,
  description: 'Built-in image generation tool powered by AI models. Configure the model in Settings > Tools.',
  enabled: true,
  builtin: true,
  transport: {
    type: 'stdio',
    command: 'node',
    args: ['/mock/builtin-mcp-image-gen.js'],
    env: imageEnv,
  },
  created_at: 1,
  updated_at: 1,
  original_json: JSON.stringify(
    {
      mcpServers: {
        [BUILTIN_IMAGE_GEN_NAME]: {
          command: 'node',
          args: ['/mock/builtin-mcp-image-gen.js'],
          env: imageEnv,
        },
      },
    },
    null,
    2
  ),
});

const configFile = {
  get: configFileGetMock,
  set: configFileSetMock,
};

const temporaryDirectories: string[] = [];

function makeTemporarySuiteFiles(): { directory: string; entryPath: string; configPath: string; launcherPath: string } {
  const directory = mkdtempSync(path.join(tmpdir(), 'aionui-mnp-migration-'));
  const entryPath = path.join(directory, 'server.mjs');
  const launcherPath = path.join(directory, 'start-pptx-mcp.sh');
  const configPath = path.join(directory, 'mcp-bootstrap.json');
  temporaryDirectories.push(directory);
  writeFileSync(entryPath, '');
  writeFileSync(launcherPath, '');
  writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      managedBy: 'MnPSuite',
      servers: [{ name: 'pptx-mcp', command: launcherPath, args: [] }],
    })
  );
  return { directory, entryPath, configPath, launcherPath };
}

beforeEach(() => {
  vi.clearAllMocks();
  configFileGetMock.mockResolvedValue(undefined);
  configFileSetMock.mockResolvedValue(undefined);
  batchImportServersMock.mockResolvedValue([]);
  deleteServerMock.mockResolvedValue(undefined);
  toggleServerMock.mockResolvedValue(undefined);
  updateServerMock.mockImplementation(async ({ id, data }) => ({
    ...imageServer(),
    id,
    ...data,
  }));
  testMcpConnectionMock.mockResolvedValue({ success: false, error: 'Command not found: npx' });
  httpRequestMock.mockImplementation(async (method: string, path: string) => {
    if (method === 'GET' && path === '/api/settings/client') {
      return {
        'tools.imageGenerationModel': {
          id: 'provider-1',
          name: 'Gemini',
          platform: 'gemini',
          use_model: 'gemini-image',
        },
      };
    }
    if (method === 'GET' && path === '/api/providers') {
      return [provider];
    }
    return undefined;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('resolveImageGenerationMigrationConfig', () => {
  it('uses backend client preference when local config file no longer has the image model', () => {
    const backendConfig = {
      id: 'gemini',
      name: 'Gemini',
      platform: 'gemini',
      base_url: 'https://example.test',
      api_key: 'backend-key',
      use_model: 'gemini-image',
    };

    expect(resolveImageGenerationMigrationConfig({ 'tools.imageGenerationModel': backendConfig }, undefined)).toEqual(
      backendConfig
    );
  });
});

describe('runBackendMigrations', () => {
  it('imports required and selected MnP Suite MCP servers on first startup', async () => {
    const { entryPath, configPath } = makeTemporarySuiteFiles();
    vi.stubEnv('MINDNPROGRESS_MCP_ENTRY', entryPath);
    vi.stubEnv('MNP_SUITE_MCP_CONFIG', configPath);
    listServersMock.mockResolvedValue([]);

    await runBackendMigrations(configFile as never);

    const imported = batchImportServersMock.mock.calls.flatMap(([request]) => request.servers);
    expect(imported.map((server) => server.name)).toEqual(expect.arrayContaining(['MindNProgress', 'pptx-mcp']));
  });

  it('preserves a user-owned server that conflicts with a managed name', async () => {
    const { entryPath } = makeTemporarySuiteFiles();
    vi.stubEnv('MINDNPROGRESS_MCP_ENTRY', entryPath);
    listServersMock.mockResolvedValue([
      {
        ...imageServer(),
        id: 'user-mnp',
        name: 'MindNProgress',
        builtin: false,
        original_json: '{"mcpServers":{"MindNProgress":{"command":"custom"}}}',
        transport: { type: 'stdio', command: 'custom', args: [] },
      },
    ]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'user-mnp' }));
    expect(warnSpy).toHaveBeenCalledWith('[Migration] skipped MnP Suite MCP name conflict: %s', 'MindNProgress');
  });

  it('adopts the unmarked required server created by older MnP Suite installers', async () => {
    const { directory, entryPath } = makeTemporarySuiteFiles();
    const legacyEntryPath = path.join(directory, 'legacy-server.mjs');
    vi.stubEnv('MINDNPROGRESS_MCP_ENTRY', entryPath);
    listServersMock.mockResolvedValue([
      {
        ...imageServer(),
        id: 'legacy-managed-mnp',
        name: 'MindNProgress',
        description: 'Required local MCP server for MindNProgress conversations',
        enabled: false,
        builtin: false,
        original_json: JSON.stringify({
          mcpServers: { MindNProgress: { command: 'node', args: [legacyEntryPath] } },
        }),
        transport: { type: 'stdio', command: 'node', args: [legacyEntryPath] },
      },
    ]);

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'legacy-managed-mnp',
        data: expect.objectContaining({
          transport: { type: 'stdio', command: 'node', args: [entryPath] },
          original_json: expect.stringContaining('MnPSuite'),
        }),
      })
    );
    expect(toggleServerMock).toHaveBeenCalledWith({ id: 'legacy-managed-mnp' });
  });

  it('updates and enables a managed server when its installation path changes', async () => {
    const { entryPath } = makeTemporarySuiteFiles();
    vi.stubEnv('MINDNPROGRESS_MCP_ENTRY', entryPath);
    listServersMock.mockResolvedValue([
      {
        ...imageServer(),
        id: 'managed-mnp',
        name: 'MindNProgress',
        enabled: false,
        builtin: false,
        original_json: JSON.stringify({ mnpSuite: { managedBy: 'MnPSuite' } }),
        transport: { type: 'stdio', command: 'node', args: ['/old/server.mjs'] },
      },
    ]);

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'managed-mnp', data: expect.objectContaining({ transport: expect.any(Object) }) })
    );
    expect(toggleServerMock).toHaveBeenCalledWith({ id: 'managed-mnp' });
  });

  it('removes a deselected optional server only when MnP Suite owns it', async () => {
    const { configPath } = makeTemporarySuiteFiles();
    writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, managedBy: 'MnPSuite', servers: [] }));
    vi.stubEnv('MNP_SUITE_MCP_CONFIG', configPath);
    listServersMock.mockResolvedValue([
      {
        ...imageServer(),
        id: 'managed-pptx',
        name: 'pptx-mcp',
        builtin: false,
        original_json: JSON.stringify({ mnpSuite: { managedBy: 'MnPSuite' } }),
        transport: { type: 'stdio', command: '/old/pptx', args: [] },
      },
    ]);

    await runBackendMigrations(configFile as never);

    expect(deleteServerMock).toHaveBeenCalledWith({ id: 'managed-pptx' });
  });

  it('does not write image generation business config back to local config storage', async () => {
    listServersMock.mockResolvedValue([imageServer()]);
    configFileGetMock.mockImplementation(async (key: string) => {
      if (key === 'tools.imageGenerationModel') {
        return {
          id: 'provider-1',
          name: 'Gemini',
          platform: 'gemini',
          use_model: 'gemini-image',
          switch: true,
        };
      }
      return undefined;
    });
    httpRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/api/settings/client') {
        return {};
      }
      if (method === 'GET' && path === '/api/providers') {
        return [provider];
      }
      return undefined;
    });

    await runBackendMigrations(configFile as never);

    expect(configFileSetMock).not.toHaveBeenCalledWith('tools.imageGenerationModel', expect.anything());
  });

  it('does not sync the built-in image MCP server when bootstrap makes no effective change', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    listServersMock.mockResolvedValue([imageServer()]);

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).not.toHaveBeenCalled();
    expect(testMcpConnectionMock).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      '[Migration] image MCP bootstrap decision, server id: %s, transport changed: %s, json changed: %s, will update: %s',
      'image-server-id',
      'no',
      'no',
      'no'
    );
  });

  it('does not sync agents when only the stored image MCP JSON representation differs', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    listServersMock.mockResolvedValue([
      {
        ...imageServer(),
        original_json: '{"legacy":true}',
      },
    ]);

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).toHaveBeenCalledOnce();
    expect(testMcpConnectionMock).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      '[Migration] image MCP bootstrap decision, server id: %s, transport changed: %s, json changed: %s, will update: %s',
      'image-server-id',
      'no',
      'yes',
      'yes'
    );
  });
});
