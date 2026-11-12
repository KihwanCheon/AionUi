/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { IMcpServer } from '@/common/config/storage';

export const MINDNPROGRESS_MCP_NAME = 'MindNProgress';
export const MINDNPROGRESS_MCP_ENTRY_ENV = 'MINDNPROGRESS_MCP_ENTRY';
export const MNP_SUITE_MCP_CONFIG_ENV = 'MNP_SUITE_MCP_CONFIG';
export const MNP_SUITE_MANAGED_BY = 'MnPSuite';
export const MNP_SUITE_OPTIONAL_MCP_NAMES = ['dooray-mcp', 'pptx-mcp'] as const;
const MINDNPROGRESS_MCP_DESCRIPTION = 'Required local MCP server for MindNProgress conversations';

type McpImportServer = Partial<IMcpServer> & Pick<IMcpServer, 'name' | 'transport'>;
type MnPSuiteMcpDescriptor = {
  schemaVersion?: unknown;
  managedBy?: unknown;
  servers?: unknown;
};
type MnPSuiteMcpServerDescriptor = {
  name?: unknown;
  description?: unknown;
  command?: unknown;
  args?: unknown;
};

export type MnPSuiteMcpBootstrap = {
  servers: McpImportServer[];
  managedNames: string[];
};

function isExistingFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function buildManagedOriginalJson(name: string, command: string, args: string[]): string {
  return JSON.stringify(
    {
      mcpServers: { [name]: { command, args } },
      mnpSuite: { managedBy: MNP_SUITE_MANAGED_BY, schemaVersion: 1 },
    },
    null,
    2
  );
}

export function buildMindNProgressMcpServer(
  entryPath = process.env[MINDNPROGRESS_MCP_ENTRY_ENV]
): McpImportServer | null {
  const normalizedEntryPath = entryPath?.trim();
  if (!normalizedEntryPath || !path.isAbsolute(normalizedEntryPath) || !isExistingFile(normalizedEntryPath)) {
    return null;
  }

  const command = 'node';
  const args = [normalizedEntryPath];
  return {
    name: MINDNPROGRESS_MCP_NAME,
    description: MINDNPROGRESS_MCP_DESCRIPTION,
    enabled: true,
    builtin: false,
    transport: { type: 'stdio', command, args },
    original_json: buildManagedOriginalJson(MINDNPROGRESS_MCP_NAME, command, args),
  };
}

function isSupportedOptionalServerName(name: string): boolean {
  return MNP_SUITE_OPTIONAL_MCP_NAMES.some((candidate) => candidate === name);
}

function buildOptionalServer(descriptor: MnPSuiteMcpServerDescriptor): McpImportServer | null {
  const name = typeof descriptor.name === 'string' ? descriptor.name.trim() : '';
  const command = typeof descriptor.command === 'string' ? descriptor.command.trim() : '';
  const args = Array.isArray(descriptor.args) ? descriptor.args : [];
  if (
    !isSupportedOptionalServerName(name) ||
    !command ||
    !path.isAbsolute(command) ||
    !isExistingFile(command) ||
    !args.every((argument) => typeof argument === 'string')
  ) {
    return null;
  }

  const normalizedArgs = args as string[];
  const description = typeof descriptor.description === 'string' ? descriptor.description.trim() : '';
  return {
    name,
    description: description || `MnP Suite managed optional MCP server: ${name}`,
    enabled: true,
    builtin: false,
    transport: { type: 'stdio', command, args: normalizedArgs },
    original_json: buildManagedOriginalJson(name, command, normalizedArgs),
  };
}

export function buildMnPSuiteOptionalMcpBootstrap(
  configPath = process.env[MNP_SUITE_MCP_CONFIG_ENV]
): MnPSuiteMcpBootstrap | null {
  const normalizedConfigPath = configPath?.trim();
  if (!normalizedConfigPath || !path.isAbsolute(normalizedConfigPath) || !isExistingFile(normalizedConfigPath)) {
    return null;
  }

  try {
    const descriptor = JSON.parse(readFileSync(normalizedConfigPath, 'utf8')) as MnPSuiteMcpDescriptor;
    if (
      descriptor.schemaVersion !== 1 ||
      descriptor.managedBy !== MNP_SUITE_MANAGED_BY ||
      !Array.isArray(descriptor.servers)
    ) {
      return null;
    }

    const servers: McpImportServer[] = [];
    const seen = new Set<string>();
    for (const value of descriptor.servers) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
      }
      const server = buildOptionalServer(value as MnPSuiteMcpServerDescriptor);
      if (!server || seen.has(server.name)) {
        return null;
      }
      seen.add(server.name);
      servers.push(server);
    }
    return { servers, managedNames: [...MNP_SUITE_OPTIONAL_MCP_NAMES] };
  } catch {
    return null;
  }
}

export function isMnPSuiteManagedMcpServer(server: Pick<IMcpServer, 'original_json'>): boolean {
  try {
    const parsed = JSON.parse(server.original_json || '{}') as { mnpSuite?: { managedBy?: unknown } };
    return parsed.mnpSuite?.managedBy === MNP_SUITE_MANAGED_BY;
  } catch {
    return false;
  }
}

export function isLegacyMnPSuiteMindNProgressMcpServer(
  server: Pick<IMcpServer, 'name' | 'description' | 'builtin' | 'transport' | 'original_json'>
): boolean {
  if (
    server.name.trim().toLowerCase() !== MINDNPROGRESS_MCP_NAME.toLowerCase() ||
    server.description !== MINDNPROGRESS_MCP_DESCRIPTION ||
    server.builtin !== false ||
    server.transport.type !== 'stdio' ||
    server.transport.command !== 'node' ||
    server.transport.args?.length !== 1 ||
    !path.isAbsolute(server.transport.args[0])
  ) {
    return false;
  }

  try {
    const parsed = JSON.parse(server.original_json || '{}') as {
      mcpServers?: Record<string, { command?: unknown; args?: unknown }>;
    };
    if (Object.keys(parsed).length !== 1 || !parsed.mcpServers || Object.keys(parsed.mcpServers).length !== 1) {
      return false;
    }
    const config = parsed.mcpServers[MINDNPROGRESS_MCP_NAME];
    return (
      config?.command === 'node' &&
      Array.isArray(config.args) &&
      config.args.length === 1 &&
      config.args[0] === server.transport.args[0]
    );
  } catch {
    return false;
  }
}
