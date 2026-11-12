/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { clipboard } from 'electron';

/**
 * Fast path: a single Explorer-copied file exposes its path via the registered
 * CFSTR_FILENAMEW clipboard format, which Electron can read directly — no process
 * spawn, so it returns instantly. The buffer is a null-terminated UTF-16LE path.
 * Returns [] when the format is absent (e.g. multi-file selections, which only
 * populate CF_HDROP).
 */
export function decodeClipboardFileName(buffer: Buffer): string[] {
  const path = buffer.toString('utf16le').split('\u0000', 1)[0]?.trim();
  return path ? [path] : [];
}

export function parsePowerShellFilePaths(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function readClipboardFilePathsNative(): string[] {
  try {
    const buffer = clipboard.readBuffer('FileNameW');
    if (buffer && buffer.length > 0) {
      return decodeClipboardFileName(buffer);
    }
  } catch {
    // ignore — fall back to the PowerShell drop-list reader
  }
  return [];
}

/**
 * Fallback for multi-file selections: CF_HDROP isn't readable by name through
 * Electron, so use PowerShell's `Get-Clipboard -Format FileDropList`. Slower
 * (~1-2s cold start) but correct for multiple files. Forcing UTF-8 output keeps
 * non-ASCII (e.g. Korean) path segments intact.
 */
function readClipboardFilePathsViaPowerShell(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }',
      ],
      { windowsHide: true, timeout: 5000, encoding: 'utf8' },
      (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        resolve(parsePowerShellFilePaths(stdout));
      }
    );
  });
}

/**
 * Read absolute paths of files currently on the OS clipboard (e.g. files copied
 * in Explorer). Returns [] off Windows or when the clipboard holds no files.
 * Tries the instant native read first; falls back to PowerShell only when needed.
 */
export function readClipboardFilePaths(): Promise<string[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  const native = readClipboardFilePathsNative();
  if (native.length > 0) return Promise.resolve(native);
  return readClipboardFilePathsViaPowerShell();
}
