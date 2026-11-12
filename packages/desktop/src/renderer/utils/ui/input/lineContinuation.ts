/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shell-style line continuation for chat textareas.
 *
 * When the caret is collapsed and immediately preceded by a backslash, pressing
 * Enter should drop that "\" and insert a newline instead of sending. Shared by
 * the conversation SendBox and the new-chat (GUID) input so both behave the same.
 *
 * The caller is responsible for guarding on Enter (without Shift) and for calling
 * `event.preventDefault()` when this returns `true` (otherwise the textarea would
 * insert a second newline by default).
 *
 * @param textarea The textarea element (read caret + restore caret after update).
 * @param setInput Controlled-input setter that applies the new value.
 * @returns `true` when a continuation newline was applied, `false` otherwise.
 */
export const applyBackslashLineContinuation = (
  textarea: HTMLTextAreaElement,
  setInput: (value: string) => void
): boolean => {
  const { selectionStart, selectionEnd, value } = textarea;
  if (selectionStart !== selectionEnd || selectionStart <= 0 || value[selectionStart - 1] !== '\\') {
    return false;
  }

  const nextValue = `${value.slice(0, selectionStart - 1)}\n${value.slice(selectionEnd)}`;
  // Removed one char ("\") and added one ("\n") → caret index is unchanged, now after the newline.
  const nextCaret = selectionStart;
  setInput(nextValue);
  // Controlled re-render reuses the same DOM node, so restore the caret on the next frame.
  requestAnimationFrame(() => {
    textarea.setSelectionRange(nextCaret, nextCaret);
  });
  return true;
};

/**
 * Handle the Enter key guard shared by chat inputs before applying a line
 * continuation. Returns true when the caller should stop processing the event.
 */
export const handleBackslashLineContinuation = (
  event: React.KeyboardEvent,
  setInput: (value: string) => void
): boolean => {
  if (event.key !== 'Enter' || event.shiftKey || !(event.currentTarget instanceof HTMLTextAreaElement)) {
    return false;
  }
  if (!applyBackslashLineContinuation(event.currentTarget, setInput)) {
    return false;
  }
  event.preventDefault();
  return true;
};
