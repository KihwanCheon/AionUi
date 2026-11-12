/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Spec for forwarding the MindNProgress Runner child's stdout/stderr into the
 * file log. The runner is forked as a utility process; without this its output
 * is discarded, so a runner that fails at startup leaves no trace anywhere.
 */

import { describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';

import { forwardRunnerOutput, forwardRunnerStream } from '@/process/startup/bootstrap/mindnprogressRunner/outputLog';

function collect(): { lines: string[]; emit: (line: string) => void } {
  const lines: string[] = [];
  return { lines, emit: (line) => lines.push(line) };
}

/** Let the stream's 'data'/'end' listeners run. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('forwardRunnerStream', () => {
  it('prefixes each complete line', async () => {
    const stream = new PassThrough();
    const { lines, emit } = collect();
    forwardRunnerStream(stream, emit);

    stream.write('runner started\nlistening\n');
    await flush();

    expect(lines).toEqual(['[mnp-runner] runner started', '[mnp-runner] listening']);
  });

  it('joins a line split across chunk boundaries', async () => {
    const stream = new PassThrough();
    const { lines, emit } = collect();
    forwardRunnerStream(stream, emit);

    stream.write('pairing ex');
    await flush();
    expect(lines).toEqual([]);

    stream.write('change failed\n');
    await flush();
    expect(lines).toEqual(['[mnp-runner] pairing exchange failed']);
  });

  it('flushes a trailing partial line when the stream ends', async () => {
    const stream = new PassThrough();
    const { lines, emit } = collect();
    forwardRunnerStream(stream, emit);

    stream.write('exiting without newline');
    stream.end();
    await flush();

    expect(lines).toEqual(['[mnp-runner] exiting without newline']);
  });

  it('strips CR and drops blank lines', async () => {
    const stream = new PassThrough();
    const { lines, emit } = collect();
    forwardRunnerStream(stream, emit);

    stream.write('windows line\r\n\n   \nreal\n');
    await flush();

    expect(lines).toEqual(['[mnp-runner] windows line', '[mnp-runner] real']);
  });

  it('does not buffer unboundedly when the runner never emits a newline', async () => {
    const stream = new PassThrough();
    const { lines, emit } = collect();
    forwardRunnerStream(stream, emit);

    stream.write('x'.repeat(5000));
    await flush();

    expect(lines).toHaveLength(1);
    expect(lines[0].length).toBeLessThanOrEqual('[mnp-runner] '.length + 4000);
  });

  it('ignores a missing stream', () => {
    const { emit } = collect();

    expect(() => forwardRunnerStream(null, emit)).not.toThrow();
    expect(() => forwardRunnerStream(undefined, emit)).not.toThrow();
  });
});

describe('forwardRunnerOutput', () => {
  it('routes stdout to info and stderr to error', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const sink = { info: vi.fn(), error: vi.fn() };
    forwardRunnerOutput({ stdout, stderr }, sink);

    stdout.write('connected\n');
    stderr.write('MNP_RUNNER_TOKEN is required.\n');
    await flush();

    expect(sink.info).toHaveBeenCalledWith('[mnp-runner] connected');
    expect(sink.error).toHaveBeenCalledWith('[mnp-runner] MNP_RUNNER_TOKEN is required.');
  });

  it('tolerates a child with no piped streams', () => {
    const sink = { info: vi.fn(), error: vi.fn() };

    expect(() => forwardRunnerOutput({ stdout: null, stderr: null }, sink)).not.toThrow();
  });
});
