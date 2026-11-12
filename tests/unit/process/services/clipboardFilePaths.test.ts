import { decodeClipboardFileName, parsePowerShellFilePaths } from '@/process/services/clipboardFilePaths';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  clipboard: { readBuffer: vi.fn() },
}));

describe('clipboard file path parsing', () => {
  it('decodes a null-terminated UTF-16LE file name', () => {
    const buffer = Buffer.from('C:\\작업\\요청서.txt\u0000ignored', 'utf16le');

    expect(decodeClipboardFileName(buffer)).toEqual(['C:\\작업\\요청서.txt']);
  });

  it('normalizes PowerShell drop-list output and removes blank lines', () => {
    expect(parsePowerShellFilePaths(' C:\\one.txt\r\n\r\nD:\\두 번째.txt\n')).toEqual([
      'C:\\one.txt',
      'D:\\두 번째.txt',
    ]);
  });
});
