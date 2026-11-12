import { insertTextAtCursor } from '@/renderer/utils/ui/input/insertTextAtCursor';
import { applyBackslashLineContinuation } from '@/renderer/utils/ui/input/lineContinuation';
import { registerFilePathPaste, tryUndoableTextPaste } from '@/renderer/utils/ui/input/pasteInput';
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { getClipboardFilePathsMock, getLastFocusedComponentMock } = vi.hoisted(() => ({
  getClipboardFilePathsMock: vi.fn(),
  getLastFocusedComponentMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    application: {
      getClipboardFilePaths: { invoke: getClipboardFilePathsMock },
    },
  },
}));

vi.mock('@/renderer/services/PasteService', () => ({
  PasteService: {
    getLastFocusedComponent: getLastFocusedComponentMock,
  },
}));

describe('chat input editing helpers', () => {
  it('replaces a trailing backslash with a newline and restores the caret', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'first\\second';
    textarea.setSelectionRange(6, 6);
    const setInput = vi.fn();
    const requestAnimationFrameMock = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    expect(applyBackslashLineContinuation(textarea, setInput)).toBe(true);
    expect(setInput).toHaveBeenCalledWith('first\nsecond');
    expect(textarea.selectionStart).toBe(6);
    expect(textarea.selectionEnd).toBe(6);

    requestAnimationFrameMock.mockRestore();
  });

  it('does not continue a line without a collapsed caret after a backslash', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'first\\';
    textarea.setSelectionRange(0, 5);

    expect(applyBackslashLineContinuation(textarea, vi.fn())).toBe(false);
  });

  it('uses the native editing pipeline for undoable text insertion', () => {
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    textarea.focus();
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });

    expect(insertTextAtCursor('C:\\one.txt')).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('insertText', false, 'C:\\one.txt');

    textarea.remove();
  });

  it('cleans ordinary clipboard text before inserting it as one undoable operation', () => {
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    textarea.focus();
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const event = new Event('paste', { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: () => 'pasted text\n   ' },
    });
    const fallback = vi.fn();

    expect(tryUndoableTextPaste(event, fallback)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('insertText', false, 'pasted text');
    expect(fallback).not.toHaveBeenCalled();

    textarea.remove();
  });

  it('inserts Ctrl+Shift+V file paths only for the focused message input', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: {} });
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    textarea.focus();
    getLastFocusedComponentMock.mockReturnValue('sendbox-1');
    getClipboardFilePathsMock.mockResolvedValue(['C:\\one.txt', 'D:\\two.txt']);
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const unregister = registerFilePathPaste({
      componentId: 'sendbox-1',
      enabled: true,
      getTextPasteHandler: () => vi.fn(),
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, shiftKey: true, key: 'v' }));

    await waitFor(() => {
      expect(execCommand).toHaveBeenCalledWith('insertText', false, 'C:\\one.txt\nD:\\two.txt');
    });
    unregister?.();
    textarea.remove();
  });
});
