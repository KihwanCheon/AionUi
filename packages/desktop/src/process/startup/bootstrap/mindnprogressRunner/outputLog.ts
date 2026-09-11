/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Forward the MindNProgress Runner child's output into the main process log.
 *
 * The runner is a utility process; its stdout/stderr are piped rather than
 * discarded so a runner that fails before it can report over IPC (bad token,
 * unreachable server, a throw during module init) still leaves a trace in the
 * daily log file. console here is already routed to electron-log by
 * configureConsoleLog, so these lines land in the same file as everything else.
 */

const LOG_PREFIX = '[mnp-runner]';
/** Cap one logged line so a runaway runner cannot blow up the log file. */
const MAX_LINE_LENGTH = 4000;

export type RunnerOutputSink = {
  info: (message: string) => void;
  error: (message: string) => void;
};

export type RunnerOutputStreams = {
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
};

/**
 * Emit one prefixed log line per output line.
 *
 * Chunks arrive at arbitrary boundaries, so a partial trailing line is held
 * until its newline arrives, and whatever remains is flushed when the stream
 * ends. A runner that never emits a newline is flushed at the length cap so
 * the buffer cannot grow without bound.
 */
export function forwardRunnerStream(
  stream: NodeJS.ReadableStream | null | undefined,
  emit: (line: string) => void
): void {
  if (!stream) return;

  let buffer = '';
  const emitLine = (raw: string): void => {
    const line = raw.replace(/\r$/, '').trim();
    if (line) emit(`${LOG_PREFIX} ${line.slice(0, MAX_LINE_LENGTH)}`);
  };

  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    buffer += chunk;
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) emitLine(part);
    if (buffer.length > MAX_LINE_LENGTH) {
      emitLine(buffer);
      buffer = '';
    }
  });
  stream.on('end', () => {
    emitLine(buffer);
    buffer = '';
  });
}

/** Route the runner's stdout to info and stderr to error. */
export function forwardRunnerOutput(child: RunnerOutputStreams, sink: RunnerOutputSink = console): void {
  forwardRunnerStream(child.stdout, (line) => sink.info(line));
  forwardRunnerStream(child.stderr, (line) => sink.error(line));
}
