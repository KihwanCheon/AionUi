/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  RunnerConfigError,
  RunnerRequestError,
  callLocalAionUi,
  createRunnerLoop,
  normalizeRunnerOperation,
  normalizeRunnerEnvironment,
  requestJson,
  runnerUrl,
  startCompletionRelay,
  type CompletionRelay,
  type RunnerResult,
} from './runtime';
import { forwardRunnerMcpRequest, startRunnerMcpRelay, type RunnerMcpRelay } from './mcpRelay';

type ParentMessage = { type?: unknown };
type RunnerEvent =
  | { type: 'connected'; label: string; connectedAt: string }
  | { type: 'connection-error'; message: string; authenticationFailed: boolean }
  | { type: 'stopped' };

const parentPort = process.parentPort;
const postEvent = (event: RunnerEvent): void => parentPort?.postMessage(event);
let activeCompletionRelay: CompletionRelay | null = null;
let activeMcpRelay: RunnerMcpRelay | null = null;

async function run(): Promise<void> {
  let config;
  try {
    config = normalizeRunnerEnvironment(process.env);
  } catch (error) {
    const message = error instanceof RunnerConfigError ? error.message : 'Runner configuration is invalid.';
    postEvent({ type: 'connection-error', message, authenticationFailed: true });
    process.exitCode = 2;
    return;
  }

  const claimController = new AbortController();
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let authenticationFailed = false;

  const mnpRequest = <T>(
    url: string,
    body: unknown,
    timeoutMs: number,
    headers: Record<string, string> = {},
    signal?: AbortSignal
  ): Promise<T> =>
    requestJson<T>(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(body),
        signal,
      },
      timeoutMs
    );

  const completionRelay = await startCompletionRelay((pathname, body) =>
    mnpRequest(`${config.apiBaseUrl}${pathname}`, body, 30_000)
  );
  activeCompletionRelay = completionRelay;
  const mcpRelay = await startRunnerMcpRelay({
    forward: (relayRequest) => forwardRunnerMcpRequest(config, relayRequest),
  });
  activeMcpRelay = mcpRelay;

  let longPollMs = 25_000;
  const heartbeat = async (): Promise<void> => {
    const info = await mnpRequest<{ label?: unknown; longPollMs?: unknown }>(
      runnerUrl(config, 'heartbeat'),
      { callbackBaseUrl: completionRelay.baseUrl },
      10_000
    );
    if (Number.isInteger(info.longPollMs) && Number(info.longPollMs) > 0) longPollMs = Number(info.longPollMs);
    postEvent({
      type: 'connected',
      label: typeof info.label === 'string' ? info.label : config.machineId,
      connectedAt: new Date().toISOString(),
    });
  };

  let loop: ReturnType<typeof createRunnerLoop>;
  loop = createRunnerLoop({
    concurrency: config.concurrency,
    retryDelayMs: config.retryDelayMs,
    claimOperations: async () => {
      const body = await mnpRequest<{ operations?: unknown }>(
        runnerUrl(config, 'operations/claim'),
        { limit: config.concurrency, waitMs: longPollMs, callbackBaseUrl: completionRelay.baseUrl },
        longPollMs + 10_000,
        {},
        claimController.signal
      );
      return Array.isArray(body.operations) ? body.operations.map(normalizeRunnerOperation) : [];
    },
    callAionUi: (request) => callLocalAionUi(config.aionUiBaseUrl, request),
    reportResult: (operationId: string, result: RunnerResult, resultToken: string) =>
      mnpRequest(runnerUrl(config, `operations/${encodeURIComponent(operationId)}/result`), result, 30_000, {
        'X-MnP-Operation-Token': resultToken,
      }),
    onClaimError: (error) => {
      const requestError = error instanceof RunnerRequestError ? error : null;
      if (requestError?.status === 401) {
        authenticationFailed = true;
        postEvent({ type: 'connection-error', message: requestError.message, authenticationFailed: true });
        loop.stop();
        claimController.abort();
        process.exitCode = 2;
        return;
      }
      postEvent({
        type: 'connection-error',
        message: error instanceof Error ? error.message : String(error),
        authenticationFailed: false,
      });
    },
  });

  const stop = (): void => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    loop.stop();
    claimController.abort();
  };
  parentPort?.on('message', (event) => {
    const message = event.data as ParentMessage;
    if (message?.type === 'stop') stop();
  });
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  try {
    await heartbeat();
  } catch (error) {
    const requestError = error instanceof RunnerRequestError ? error : null;
    authenticationFailed = requestError?.status === 401;
    postEvent({
      type: 'connection-error',
      message: error instanceof Error ? error.message : String(error),
      authenticationFailed,
    });
    if (authenticationFailed) {
      process.exitCode = 2;
      await mcpRelay.close();
      activeMcpRelay = null;
      await completionRelay.close();
      activeCompletionRelay = null;
      return;
    }
  }

  heartbeatTimer = setInterval(() => {
    void heartbeat().catch((error) => {
      const requestError = error instanceof RunnerRequestError ? error : null;
      if (requestError?.status === 401) {
        authenticationFailed = true;
        process.exitCode = 2;
        stop();
      }
      postEvent({
        type: 'connection-error',
        message: error instanceof Error ? error.message : String(error),
        authenticationFailed: requestError?.status === 401,
      });
    });
  }, config.heartbeatIntervalMs);

  await loop.start();
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  await mcpRelay.close();
  activeMcpRelay = null;
  await completionRelay.close();
  activeCompletionRelay = null;
  if (!authenticationFailed) postEvent({ type: 'stopped' });
}

void run().catch(async (error: unknown) => {
  if (activeMcpRelay) {
    try {
      await activeMcpRelay.close();
    } catch {
      // Preserve the original Runner failure reported below.
    }
  }
  activeMcpRelay = null;
  if (activeCompletionRelay) {
    try {
      await activeCompletionRelay.close();
    } catch {
      // Preserve the original Runner failure reported below.
    }
  }
  activeCompletionRelay = null;
  postEvent({
    type: 'connection-error',
    message: error instanceof Error ? error.message : String(error),
    authenticationFailed: false,
  });
  process.exitCode = 1;
});
