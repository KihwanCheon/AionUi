/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer } from 'node:http';

export type RunnerEnvironment = {
  MNP_RUNNER_API_URL?: string;
  MNP_RUNNER_MACHINE_ID?: string;
  MNP_RUNNER_TOKEN?: string;
  MNP_RUNNER_AIONUI_URL?: string;
  MNP_RUNNER_CONCURRENCY?: string;
  MNP_RUNNER_HEARTBEAT_MS?: string;
  MNP_RUNNER_RETRY_MS?: string;
};

export type RunnerConfig = {
  apiBaseUrl: string;
  machineId: string;
  token: string;
  aionUiBaseUrl: string;
  concurrency: number;
  heartbeatIntervalMs: number;
  retryDelayMs: number;
};

export type RunnerOperation = {
  operationId: string;
  resultToken: string;
  request: {
    pathname: string;
    method: string;
    body?: unknown;
    timeoutMs: number;
  };
};

export type RunnerResult = {
  ok: boolean;
  status?: number | null;
  code?: string | null;
  message?: string;
  data?: unknown;
};

export class RunnerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunnerConfigError';
  }
}

export class RunnerRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null
  ) {
    super(message);
    this.name = 'RunnerRequestError';
  }
}

const RUNNER_LOCAL_ORIGIN = 'http://mindnprogress-runner.local';
const RUNNER_OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{12,100}$/;
const RUNNER_RESULT_TOKEN_PATTERN = /^mnop_[A-Za-z0-9_-]{40,100}$/;
const AIONUI_ENTITY_ID_PATTERN = '[A-Za-z0-9_-]{1,160}';
const COMPLETION_CALLBACK_PATH_PATTERN = /^\/api\/integrations\/aionui\/launches\/[A-Za-z0-9_-]{32,128}\/conversation$/;
const COMPLETION_CALLBACK_BODY_LIMIT = 16 * 1024;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseUrl(value: unknown, label: string): string {
  const candidate = text(value);
  if (!candidate) throw new RunnerConfigError(`${label} is required.`);
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate);
  if (hasScheme && !/^https?:\/\//i.test(candidate)) {
    throw new RunnerConfigError(`${label} must use http or https.`);
  }

  let url: URL;
  try {
    url = new URL(hasScheme ? candidate : `http://${candidate}`);
  } catch {
    throw new RunnerConfigError(`${label} is not a valid URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RunnerConfigError(`${label} must use http or https.`);
  }
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sendJson(response: import('node:http').ServerResponse, status: number, body: unknown): void {
  const content = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(content),
    'Cache-Control': 'no-store',
  });
  response.end(content);
}

async function readCallbackBody(request: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const source of request) {
    const chunk = Buffer.isBuffer(source) ? source : Buffer.from(source);
    size += chunk.length;
    if (size > COMPLETION_CALLBACK_BODY_LIMIT) throw new RunnerRequestError('Callback body is too large.', 413);
    chunks.push(chunk);
  }

  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RunnerRequestError('Callback body is invalid.', 400);
  }
  if (!isRecord(body)) throw new RunnerRequestError('Callback body is invalid.', 400);
  return body;
}

export type CompletionRelay = {
  baseUrl: string;
  close: () => Promise<void>;
};

// AionCore intentionally accepts external-launch completion callbacks only on loopback.
// The sidecar receives that local callback and forwards it through its authenticated,
// outbound-only connection to MindNProgress. No LAN-facing listener is opened.
export async function startCompletionRelay(
  forward: (pathname: string, body: Record<string, unknown>) => Promise<unknown>
): Promise<CompletionRelay> {
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method !== 'POST' || url.search || !COMPLETION_CALLBACK_PATH_PATTERN.test(url.pathname)) {
        sendJson(response, 404, { error: 'Unsupported completion callback.' });
        return;
      }
      const body = await readCallbackBody(request);
      await forward(url.pathname, body);
      sendJson(response, 200, { delivered: true });
    })().catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      const status =
        error instanceof RunnerRequestError && error.status !== null && error.status < 500 ? error.status : 502;
      sendJson(response, status, { error: 'Failed to forward completion callback.' });
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
    throw new Error('Failed to resolve the completion relay address.');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function isAllowedLocalRequest(method: string, url: URL): boolean {
  const pathname = url.pathname;
  const hasQuery = url.searchParams.size > 0;
  if (method === 'GET') {
    if (
      !hasQuery &&
      [
        '/api/agents/management',
        '/api/providers',
        '/api/skills',
        '/api/mcp/servers',
        '/api/internal/conversation-runtimes/active',
        '/api/internal/external-conversation-dispatches/capabilities',
      ].includes(pathname)
    ) {
      return true;
    }
    if (!hasQuery && new RegExp(`^/api/conversations/${AIONUI_ENTITY_ID_PATTERN}$`).test(pathname)) return true;
    if (
      !hasQuery &&
      new RegExp(`^/api/internal/external-conversation-dispatches/${AIONUI_ENTITY_ID_PATTERN}$`).test(pathname)
    ) {
      return true;
    }
    if (!new RegExp(`^/api/conversations/${AIONUI_ENTITY_ID_PATTERN}/messages$`).test(pathname)) return false;
    const keys = [...url.searchParams.keys()];
    return (
      keys.length === 2 &&
      new Set(keys).size === 2 &&
      ['100', '10000'].includes(url.searchParams.get('limit') ?? '') &&
      url.searchParams.get('content_mode') === 'full'
    );
  }
  if (method === 'PATCH') {
    return !hasQuery && new RegExp(`^/api/conversations/${AIONUI_ENTITY_ID_PATTERN}$`).test(pathname);
  }
  if (method === 'POST') {
    return (
      !hasQuery &&
      (pathname === '/api/internal/external-conversation-dispatches' ||
        pathname === '/api/internal/external-conversation-launches' ||
        new RegExp(`^/api/internal/external-conversation-dispatches/${AIONUI_ENTITY_ID_PATTERN}/complete$`).test(
          pathname
        ))
    );
  }
  return false;
}

export function normalizeRunnerOperationRequest(value: unknown): RunnerOperation['request'] {
  if (!isRecord(value)) throw new RunnerConfigError('Runner operation request is invalid.');
  const method = text(value.method).toUpperCase();
  const pathname = text(value.pathname);
  if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes('\\') || pathname.includes('#')) {
    throw new RunnerConfigError('Runner operation path is invalid.');
  }

  let url: URL;
  try {
    url = new URL(pathname, RUNNER_LOCAL_ORIGIN);
  } catch {
    throw new RunnerConfigError('Runner operation path is invalid.');
  }
  if (url.origin !== RUNNER_LOCAL_ORIGIN || !isAllowedLocalRequest(method, url)) {
    throw new RunnerConfigError('Runner operation is not allowed.');
  }

  return {
    pathname: `${url.pathname}${url.search}`,
    method,
    ...(value.body === undefined ? {} : { body: value.body }),
    timeoutMs: boundedNumber(value.timeoutMs, 8_000, 1_000, 600_000),
  };
}

export function normalizeRunnerOperation(value: unknown): RunnerOperation {
  if (!isRecord(value)) throw new RunnerConfigError('Runner operation is invalid.');
  const operationId = text(value.operationId);
  const resultToken = text(value.resultToken);
  if (!RUNNER_OPERATION_ID_PATTERN.test(operationId) || !RUNNER_RESULT_TOKEN_PATTERN.test(resultToken)) {
    throw new RunnerConfigError('Runner operation credentials are invalid.');
  }
  return {
    operationId,
    resultToken,
    request: normalizeRunnerOperationRequest(value.request),
  };
}

export function normalizeRunnerEnvironment(environment: RunnerEnvironment): RunnerConfig {
  const machineId = text(environment.MNP_RUNNER_MACHINE_ID).toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(machineId)) {
    throw new RunnerConfigError('MNP_RUNNER_MACHINE_ID is invalid.');
  }
  const token = text(environment.MNP_RUNNER_TOKEN);
  if (!token) throw new RunnerConfigError('MNP_RUNNER_TOKEN is required.');

  return {
    apiBaseUrl: normalizeBaseUrl(environment.MNP_RUNNER_API_URL, 'MNP_RUNNER_API_URL'),
    machineId,
    token,
    aionUiBaseUrl: normalizeBaseUrl(environment.MNP_RUNNER_AIONUI_URL, 'MNP_RUNNER_AIONUI_URL'),
    concurrency: boundedNumber(environment.MNP_RUNNER_CONCURRENCY, 4, 1, 16),
    heartbeatIntervalMs: boundedNumber(environment.MNP_RUNNER_HEARTBEAT_MS, 60_000, 5_000, 600_000),
    retryDelayMs: boundedNumber(environment.MNP_RUNNER_RETRY_MS, 3_000, 500, 60_000),
  };
}

export function runnerUrl(config: RunnerConfig, suffix: string): string {
  return `${config.apiBaseUrl}/api/machines/${encodeURIComponent(config.machineId)}/runner/${suffix}`;
}

export async function requestJson<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal });
  } catch (error) {
    throw new RunnerRequestError(error instanceof Error ? error.message : String(error), null);
  }
  const responseBody = (await response.json().catch(() => ({}))) as { error?: unknown };
  if (!response.ok) {
    const message = typeof responseBody.error === 'string' ? responseBody.error : `Request failed (${response.status})`;
    throw new RunnerRequestError(message, response.status);
  }
  return responseBody as T;
}

export async function callLocalAionUi(
  baseUrl: string,
  request: RunnerOperation['request'],
  fetchImpl: typeof fetch = fetch
): Promise<RunnerResult> {
  try {
    const normalizedRequest = normalizeRunnerOperationRequest(request);
    const response = await fetchImpl(`${baseUrl}${normalizedRequest.pathname}`, {
      method: normalizedRequest.method,
      headers: {
        Accept: 'application/json',
        ...(normalizedRequest.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: normalizedRequest.body === undefined ? undefined : JSON.stringify(normalizedRequest.body),
      signal: AbortSignal.timeout(normalizedRequest.timeoutMs),
    });
    const responseBody = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      data?: unknown;
      error?: { code?: string } | string;
      code?: string;
    };
    if (!response.ok || responseBody.success === false) {
      return {
        ok: false,
        status: response.status,
        code: typeof responseBody.error === 'object' ? (responseBody.error?.code ?? null) : (responseBody.code ?? null),
      };
    }
    return { ok: true, data: responseBody.data ?? responseBody };
  } catch (error) {
    return {
      ok: false,
      status: null,
      code: 'RUNNER_LOCAL_CALL_FAILED',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

type RunnerLoopOptions = {
  claimOperations: () => Promise<RunnerOperation[]>;
  callAionUi: (request: RunnerOperation['request']) => Promise<RunnerResult>;
  reportResult: (operationId: string, result: RunnerResult, resultToken: string) => Promise<unknown>;
  concurrency: number;
  retryDelayMs: number;
  onClaimError: (error: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
};

export function createRunnerLoop(options: RunnerLoopOptions) {
  let stopped = false;

  const settle = async (operation: RunnerOperation): Promise<void> => {
    const result = await options.callAionUi(operation.request);
    let attempt = 0;
    while (!stopped || attempt === 0) {
      attempt += 1;
      try {
        await options.reportResult(operation.operationId, result, operation.resultToken);
        return;
      } catch (error) {
        const status = error instanceof RunnerRequestError ? error.status : null;
        if ((status !== null && status !== 408 && status !== 429 && status < 500) || attempt >= 200) return;
        await (options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(options.retryDelayMs);
      }
    }
  };

  const settleAll = async (operations: RunnerOperation[]): Promise<void> => {
    const queue = [...operations];
    await Promise.all(
      Array.from({ length: Math.min(options.concurrency, queue.length) }, async () => {
        while (queue.length > 0) {
          const operation = queue.shift();
          if (operation) await settle(operation);
        }
      })
    );
  };

  return {
    async start(): Promise<void> {
      while (!stopped) {
        try {
          const operations = await options.claimOperations();
          if (operations.length > 0) await settleAll(operations);
        } catch (error) {
          if (stopped) break;
          options.onClaimError(error);
          await (options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(options.retryDelayMs);
        }
      }
    },
    stop(): void {
      stopped = true;
    },
  };
}
