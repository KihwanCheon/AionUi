/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Insert `text` at the caret of the currently-focused editable element using the
 * native `document.execCommand('insertText')`.
 *
 * Unlike a React `setState`/controlled-value replacement, this goes through the
 * browser's native editing pipeline, so the change:
 *   - joins the element's undo stack (Ctrl+Z removes the whole insert), and
 *   - fires a trusted `input` event that drives the controlled component's
 *     `onChange`, keeping React state in sync automatically.
 *
 * Must be called synchronously inside a user-gesture handler (paste/keydown).
 * Returns `false` when there is no editable target or the command is
 * unavailable — callers should fall back to a manual insert.
 */
export function insertTextAtCursor(text: string): boolean {
  const el = document.activeElement;
  const isEditable = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
  if (!isEditable) return false;
  try {
    return document.execCommand('insertText', false, text);
  } catch {
    return false;
  }
}
