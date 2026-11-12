/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';

const recoveredLists = new WeakSet<readonly TMessage[]>();

/** Keep recovery provenance local to the renderer; never alter stored messages. */
export function markRecoveredMessageList(messages: TMessage[]): TMessage[] {
  recoveredLists.add(messages);
  return messages;
}

/** Distinguish history hydration from a user sending a new message. */
export function isRecoveredMessageList(messages: readonly TMessage[]): boolean {
  return recoveredLists.has(messages);
}

/** Preserve component state when a live row acquires its persisted database id. */
export function getMessageRenderKey(message: TMessage): string {
  const identity = message.type === 'ask' ? message.content.request_id || message.msg_id : message.msg_id;
  return JSON.stringify([message.conversation_id, message.type, identity || message.id]);
}
