// Core types for @aionui/web-host (M3 interface contract, locked for M4-M8)
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Optional native-host extension; the host remains responsible for its own authorization. */
export type WebHostRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  context: { backendPort: number; clientAddress: string | null }
) => Promise<boolean>;

/**
 * App metadata injected by host environment (Electron or Node)
 */
export type AppMetadata = {
  version: string;
  isPackaged: boolean;
  resourcesPath: string;
  userDataPath: string;
};

/**
 * Backend binary resolver function injected by host environment
 */
export type BackendBinaryResolver = () => string;

/**
 * System dirs exported to the backend via AIONUI_{CACHE,WORK,LOG}_DIR env.
 * Backend surfaces these on `/api/system/info`. Omit and the backend inherits
 * process.env, which may carry stale values from the parent shell — better to
 * be explicit.
 */
export type BackendSystemDirs = {
  cacheDir: string;
  workDir: string;
  logDir: string;
};

/**
 * Options for starting WebHost
 */
export type WebHostOptions = {
  requestHandler?: WebHostRequestHandler;
  app: AppMetadata;
  staticDir: string;
  /** Development renderer URL. When set, browser assets are proxied here instead of read from staticDir. */
  frontendUrl?: string;
  port?: number;
  allowRemote?: boolean;
  dataDir?: string;
  logDir?: string;
  dirs?: BackendSystemDirs;
  backend: { kind: 'ownBackend'; resolveBackend: BackendBinaryResolver } | { kind: 'useExistingBackend'; port: number };
};

/**
 * Handle returned by startWebHost
 */
export type WebHostHandle = {
  port: number;
  backendPort: number;
  url: string;
  localUrl: string;
  networkUrl?: string;
  lanIP?: string;
  stop: () => Promise<void>;
};
