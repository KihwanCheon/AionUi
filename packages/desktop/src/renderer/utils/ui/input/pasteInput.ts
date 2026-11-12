/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { PasteService } from '@/renderer/services/PasteService';

import { insertTextAtCursor } from './insertTextAtCursor';

type TextPasteHandler = (text: string) => void;
type ClipboardPasteEvent = {
  clipboardData: DataTransfer | null;
  preventDefault: () => void;
  stopPropagation: () => void;
};

/**
 * Insert ordinary clipboard text through the native editing pipeline so the
 * browser records it as one undoable action.
 */
export const tryUndoableTextPaste = (event: ClipboardPasteEvent, onTextPaste?: TextPasteHandler): boolean => {
  if (!onTextPaste) return false;
  const isIOS = typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent);
  const text = event.clipboardData?.getData('text') ?? '';
  const activeElement = document.activeElement;
  const isEditable = activeElement instanceof HTMLTextAreaElement || activeElement instanceof HTMLInputElement;
  if (!text || isIOS || !isEditable) return false;

  const cleanedText = text.replace(/\n\s*$/, '');
  event.preventDefault();
  event.stopPropagation();
  if (!insertTextAtCursor(cleanedText)) {
    onTextPaste(cleanedText);
  }
  return true;
};

type RegisterFilePathPasteParams = {
  componentId: string;
  enabled: boolean;
  getTextPasteHandler: () => TextPasteHandler | undefined;
};

/**
 * Register Ctrl+Shift+V for a focused message input and insert Explorer file
 * paths as a single undoable text operation.
 */
export const registerFilePathPaste = ({
  componentId,
  enabled,
  getTextPasteHandler,
}: RegisterFilePathPasteParams): (() => void) | undefined => {
  if (!enabled) return undefined;

  const onKeyDown = (event: KeyboardEvent): void => {
    const isPasteAsPath =
      (event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'v' || event.key === 'V');
    if (!isPasteAsPath || PasteService.getLastFocusedComponent() !== componentId) return;

    const insertText = getTextPasteHandler();
    if (!insertText || typeof window === 'undefined' || !window.electronAPI) return;

    event.preventDefault();
    void (async () => {
      try {
        const paths = await ipcBridge.application.getClipboardFilePaths.invoke();
        if (!paths || paths.length === 0) return;
        const text = paths.join('\n');
        if (!insertTextAtCursor(text)) {
          insertText(text);
        }
      } catch (error) {
        console.error('Failed to read clipboard file paths:', error);
      }
    })();
  };

  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
};
