import { describe, expect, it, vi } from 'vitest';
import {
  RunnerConfigError,
  RunnerRequestError,
  callLocalAionUi,
  createRunnerLoop,
  normalizeRunnerEnvironment,
  normalizeRunnerOperation,
  normalizeRunnerOperationRequest,
  startCompletionRelay,
  type RunnerOperation,
  type RunnerResult,
} from '@/process/resources/mindnprogressRunner/runtime';

function operation(operationId = 'operation_123456', pathname = '/api/internal/external-conversation-dispatches') {
  return {
    operationId,
    resultToken: `mnop_${'a'.repeat(43)}`,
    request: { pathname, method: 'POST', timeoutMs: 1_000 },
  };
}

async function runClaimedOperations(
  operations: unknown[],
  overrides: Partial<Parameters<typeof createRunnerLoop>[0]> = {}
) {
  const callAionUi = vi.fn(async () => ({ ok: true, data: { done: true } }));
  const reportResult = vi.fn(async (_id: string, _result: RunnerResult, _token: string) => undefined);
  const onClaimError = vi.fn();
  let claimed = false;
  let loop: ReturnType<typeof createRunnerLoop>;
  loop = createRunnerLoop({
    claimOperations: async () => {
      if (!claimed) {
        claimed = true;
        return operations;
      }
      loop.stop();
      return [];
    },
    callAionUi,
    reportResult,
    onClaimError,
    concurrency: 2,
    retryDelayMs: 1,
    sleep: async () => undefined,
    ...overrides,
  });
  await loop.start();
  return { callAionUi, reportResult, onClaimError };
}

describe('MindNProgress Runner runtime', () => {
  it.each([
    ['GET', '/api/sidebar/conversation/conversation-1/archive-state'],
    ['POST', '/api/sidebar/conversation/conversation-1/archive'],
  ])('allows verified conversation archiving: %s %s', (method, pathname) => {
    expect(normalizeRunnerOperationRequest({ method, pathname })).toMatchObject({ method, pathname });
  });

  it.each([
    ['DELETE', '/api/sidebar/archived/conversation/conversation-1'],
    ['DELETE', '/api/sidebar/conversation/conversation-1/archive'],
    ['POST', '/api/sidebar/conversation/conversation-1/unarchive'],
    ['POST', '/api/sidebar/project/project-1/archive'],
    ['GET', '/api/sidebar/conversation/conversation-1/archive-state?all=1'],
    ['POST', '/api/sidebar/conversation/conversation-1/archive?force=true'],
    ['POST', '/api/sidebar/conversation/conversation-1/archive-state'],
  ])('rejects unrelated archive access: %s %s', (method, pathname) => {
    expect(() => normalizeRunnerOperationRequest({ method, pathname })).toThrow('Runner operation is not allowed.');
  });

  it('allows a session message relayed from another machine', () => {
    const body = {
      fromConversationId: 'conv-main',
      fromName: 'Main',
      to: 'conv-mac',
      message: 'hi',
      fromMachine: 'PC',
    };
    expect(
      normalizeRunnerOperationRequest({ method: 'POST', pathname: '/api/internal/session-messages/remote', body })
    ).toMatchObject({ method: 'POST', pathname: '/api/internal/session-messages/remote', body });
  });

  it.each([
    ['GET', '/api/internal/session-messages/remote'],
    ['POST', '/api/internal/session-messages/remote?retry=1'],
    ['POST', '/api/internal/session-messages/remote/extra'],
    ['POST', '/api/session-messages'],
  ])('rejects other session message access: %s %s', (method, pathname) => {
    expect(() => normalizeRunnerOperationRequest({ method, pathname })).toThrow('Runner operation is not allowed.');
  });

  it('normalizes bounded configuration without exposing the token in derived URLs', () => {
    const config = normalizeRunnerEnvironment({
      MNP_RUNNER_API_URL: 'https://mnp.example.test/path?q=1',
      MNP_RUNNER_MACHINE_ID: 'MACBOOK',
      MNP_RUNNER_TOKEN: 'secret-token',
      MNP_RUNNER_AIONUI_URL: 'http://127.0.0.1:4312',
      MNP_RUNNER_CONCURRENCY: '99',
    });

    expect(config.apiBaseUrl).toBe('https://mnp.example.test');
    expect(config.machineId).toBe('macbook');
    expect(config.concurrency).toBe(16);
    expect(JSON.stringify({ ...config, token: undefined })).not.toContain('secret-token');
  });

  it('rejects missing credentials and non-http server URLs', () => {
    expect(() =>
      normalizeRunnerEnvironment({
        MNP_RUNNER_API_URL: 'ftp://mnp.example.test',
        MNP_RUNNER_MACHINE_ID: 'macbook',
        MNP_RUNNER_TOKEN: 'token',
        MNP_RUNNER_AIONUI_URL: 'http://127.0.0.1:4312',
      })
    ).toThrow(RunnerConfigError);
  });

  it('finishes claimed work before a graceful stop completes', async () => {
    const acceptedOperation: RunnerOperation = {
      operationId: 'operation_123456',
      resultToken: `mnop_${'a'.repeat(43)}`,
      request: {
        pathname: '/api/internal/external-conversation-dispatches',
        method: 'POST',
        timeoutMs: 1_000,
      },
    };
    let claims = 0;
    const reported = vi.fn(async () => undefined);
    let loop: ReturnType<typeof createRunnerLoop>;
    loop = createRunnerLoop({
      claimOperations: async () => {
        claims += 1;
        if (claims === 1) return [acceptedOperation];
        loop.stop();
        return [];
      },
      callAionUi: async () => ({ ok: true, data: { done: true } }),
      reportResult: reported,
      concurrency: 1,
      retryDelayMs: 1,
      onClaimError: vi.fn(),
    });

    await loop.start();
    expect(reported).toHaveBeenCalledWith(
      'operation_123456',
      { ok: true, data: { done: true } },
      `mnop_${'a'.repeat(43)}`
    );
  });

  it('accepts only the AionCore API routes and methods required by MindNProgress', () => {
    expect(
      normalizeRunnerOperation({
        operationId: 'operation_123456',
        resultToken: `mnop_${'a'.repeat(43)}`,
        request: {
          pathname: '/api/conversations/conversation_1/messages?limit=100&content_mode=full',
          method: 'GET',
          timeoutMs: 30_000,
        },
      }).request.pathname
    ).toBe('/api/conversations/conversation_1/messages?limit=100&content_mode=full');

    expect(() =>
      normalizeRunnerOperation({
        operationId: 'operation_123456',
        resultToken: `mnop_${'a'.repeat(43)}`,
        request: { pathname: '/api/config', method: 'GET', timeoutMs: 30_000 },
      })
    ).toThrow('Runner operation is not allowed.');
  });

  it('does not call AionCore when an untrusted Runner operation bypasses claim validation', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await callLocalAionUi(
      'http://127.0.0.1:4312',
      { pathname: '/api/config', method: 'DELETE', timeoutMs: 1_000 },
      fetchImpl
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, code: 'RUNNER_OPERATION_REJECTED' });
  });

  it('accepts the history-only completion report without changing its payload', () => {
    const claimed = operation('operation_123456', '/api/conversations/conversation_1/external-reports');
    const request = { ...claimed.request, body: { operationId: 'mnp-report-123456', content: 'Completed audit' } };

    expect(normalizeRunnerOperation({ ...claimed, request }).request).toEqual(request);
  });

  it('forwards the history-only report and returns its receipt without requesting AI execution', async () => {
    const body = { operationId: 'mnp-report-123456', content: 'Completed audit' };
    const receipt = { operationId: body.operationId, conversationId: 'conversation_1', executionRequested: false };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ success: true, data: receipt }), { status: 200 }));

    const result = await callLocalAionUi(
      'http://127.0.0.1:4312',
      { ...operation().request, pathname: '/api/conversations/conversation_1/external-reports', body },
      fetchImpl
    );

    expect(result).toEqual({ ok: true, data: receipt });
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
      'http://127.0.0.1:4312/api/conversations/conversation_1/external-reports',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(body) })
    );
  });

  it.each([
    ['GET', '/api/conversations/conversation_1/external-reports'],
    ['DELETE', '/api/conversations/conversation_1/external-reports'],
    ['POST', '/api/conversations/conversation_1/external-reports?extra=1'],
    ['POST', '/api/conversations/conversation_1/external-reports/extra'],
    ['POST', '//untrusted.example/api/conversations/conversation_1/external-reports'],
  ])('still rejects unrelated report requests: %s %s', (method, pathname) => {
    expect(() => normalizeRunnerOperation({ ...operation(), request: { method, pathname } })).toThrow(
      RunnerConfigError
    );
  });

  it('reports a rejected request immediately without dropping the valid request in the same claim', async () => {
    const rejected = operation('operation_rejected', '/api/config');
    const accepted = operation('operation_accepted');
    const { callAionUi, reportResult, onClaimError } = await runClaimedOperations([rejected, accepted]);

    expect(callAionUi).toHaveBeenCalledExactlyOnceWith(accepted.request);
    expect(reportResult).toHaveBeenCalledWith(
      rejected.operationId,
      { ok: false, status: null, code: 'RUNNER_OPERATION_REJECTED', message: 'Runner operation is not allowed.' },
      rejected.resultToken
    );
    expect(onClaimError).not.toHaveBeenCalled();
  });

  it.each([null, { ...operation(), operationId: '../invalid' }, { ...operation(), resultToken: 'invalid' }])(
    'does not call or report using malformed credentials, while valid siblings still complete',
    async (invalid) => {
      const accepted = operation('operation_accepted');
      const { callAionUi, reportResult, onClaimError } = await runClaimedOperations([invalid, accepted]);

      expect(callAionUi).toHaveBeenCalledExactlyOnceWith(accepted.request);
      expect(reportResult).toHaveBeenCalledExactlyOnceWith(
        accepted.operationId,
        { ok: true, data: { done: true } },
        accepted.resultToken
      );
      expect(onClaimError).toHaveBeenCalledOnce();
    }
  );

  it('retries only the rejection result when the first result response is lost', async () => {
    const rejected = operation('operation_rejected', '/api/config');
    const reportResult = vi
      .fn()
      .mockRejectedValueOnce(new RunnerRequestError('Result response lost.', null))
      .mockResolvedValue(undefined);
    const { callAionUi } = await runClaimedOperations([rejected], { reportResult });

    expect(callAionUi).not.toHaveBeenCalled();
    expect(reportResult).toHaveBeenCalledTimes(2);
    expect(reportResult.mock.calls[0]).toEqual(reportResult.mock.calls[1]);
  });

  it('returns a local call exception as a failure result rather than abandoning the claimed request', async () => {
    const accepted = operation();
    const { reportResult, onClaimError } = await runClaimedOperations([accepted], {
      callAionUi: async () => {
        throw new Error('Local connection refused.');
      },
    });

    expect(reportResult).toHaveBeenCalledWith(
      accepted.operationId,
      { ok: false, status: null, code: 'RUNNER_LOCAL_CALL_FAILED', message: 'Local connection refused.' },
      accepted.resultToken
    );
    expect(onClaimError).not.toHaveBeenCalled();
  });

  it.each(['Report API is unavailable.', { code: 'REPORT_DISABLED', message: 'Report API is unavailable.' }])(
    'preserves the AionCore failure message together with its status',
    async (error) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify({ success: false, error }), { status: 503 }));
      const result = await callLocalAionUi('http://127.0.0.1:4312', operation().request, fetchImpl);

      expect(result).toMatchObject({ ok: false, status: 503, message: 'Report API is unavailable.' });
    }
  );

  it('reports a history-only completion receipt through the claim loop', async () => {
    const accepted = operation('operation_reported', '/api/conversations/conversation_1/external-reports');
    const receipt = { executionRequested: false, operationId: 'mnp-report-123456' };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ success: true, data: receipt }), { status: 200 }));
    const { reportResult } = await runClaimedOperations([accepted], {
      callAionUi: (request) => callLocalAionUi('http://127.0.0.1:4312', request, fetchImpl),
    });

    expect(reportResult).toHaveBeenCalledExactlyOnceWith(
      accepted.operationId,
      { ok: true, data: receipt },
      accepted.resultToken
    );
  });

  it('relays a tokenized loopback external-launch completion callback to MindNProgress', async () => {
    const forward = vi.fn(async () => undefined);
    const relay = await startCompletionRelay(forward);
    const pathname = `/api/integrations/aionui/launches/${'a'.repeat(43)}/conversation`;

    try {
      const delivered = await fetch(`${relay.baseUrl}${pathname}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'conversation_1' }),
      });
      expect(delivered.status).toBe(200);
      expect(forward).toHaveBeenCalledWith(pathname, { conversationId: 'conversation_1' });
    } finally {
      await relay.close();
    }
  });

  it('rejects unrelated loopback requests without forwarding them', async () => {
    const forward = vi.fn(async () => undefined);
    const relay = await startCompletionRelay(forward);

    try {
      const rejected = await fetch(`${relay.baseUrl}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'conversation_1' }),
      });
      expect(rejected.status).toBe(404);
      expect(forward).not.toHaveBeenCalled();
    } finally {
      await relay.close();
    }
  });

  it('does not acknowledge a completion callback when MindNProgress rejects it', async () => {
    const relay = await startCompletionRelay(async () => {
      throw new RunnerRequestError('MindNProgress rejected the callback.', 404);
    });

    try {
      const response = await fetch(`${relay.baseUrl}/api/integrations/aionui/launches/${'b'.repeat(43)}/conversation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'conversation_2' }),
      });
      expect(response.status).toBe(404);
    } finally {
      await relay.close();
    }
  });
});
