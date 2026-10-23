/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AIONUI_SESSION_MESSAGE_END_MARKER,
  AIONUI_SESSION_MESSAGE_MARKER,
  AIONUI_SESSIONS_END_MARKER,
  AIONUI_SESSIONS_MARKER,
} from '@/common/config/constants';

export type SessionMentionChip = {
  name: string;
  id: string;
  workspace: string;
};

export type SessionDeliverySource = {
  fromName: string;
  fromId: string;
  workspace: string;
  replyTo: string;
  // Undefined means local; null means a remote source without a usable URL.
  externalUrl?: string | null;
};

/**
 * Locate a marker-delimited block and return the text with it removed.
 *
 * A missing closing marker returns `null` so the caller renders the original
 * content untouched: showing a stray marker line is ugly, but swallowing the
 * user's message is data loss.
 */
function extractBlock(
  content: string,
  startMarker: string,
  endMarker: string
): { body: string[]; text: string } | null {
  const startIndex = content.indexOf(startMarker);
  if (startIndex === -1) return null;
  const endIndex = content.indexOf(endMarker, startIndex + startMarker.length);
  if (endIndex === -1) return null;

  const inner = content.slice(startIndex + startMarker.length, endIndex);
  const before = content.slice(0, startIndex);
  const after = content.slice(endIndex + endMarker.length);
  return {
    body: inner
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
    text: `${before}${after}`.trim(),
  };
}

/**
 * Sender side: reverse the `[[AION_SESSIONS]]` block the backend appended to the
 * user's own message so the bubble shows chips instead of raw markers.
 */
export function parseSessionsBlock(content: string): { text: string; sessions: SessionMentionChip[] } {
  const block = extractBlock(content, AIONUI_SESSIONS_MARKER, AIONUI_SESSIONS_END_MARKER);
  if (!block) return { text: content, sessions: [] };

  const sessions: SessionMentionChip[] = [];
  for (const line of block.body) {
    // `name \t id \t workspace: VALUE`
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [name, id, workspaceField] = parts;
    if (!name || !id) continue;
    sessions.push({
      name,
      id,
      workspace: workspaceField.replace(/^workspace:\s*/, ''),
    });
  }
  return { text: block.text, sessions };
}

/**
 * Recipient side: reverse the `[[AION_SESSION_MESSAGE]]` block so the bubble can
 * show a "from conversation X" badge. Same content the agent read — one source
 * of truth, no artifact (spec §5.6).
 */
export function parseSessionMessageBlock(content: string): { text: string; source: SessionDeliverySource | null } {
  const block = extractBlock(content, AIONUI_SESSION_MESSAGE_MARKER, AIONUI_SESSION_MESSAGE_END_MARKER);
  if (!block) return { text: content, source: null };

  let fromName = '';
  let fromId = '';
  let workspace = '';
  let replyTo = '';
  for (const line of block.body) {
    if (line.startsWith('from: ')) {
      const [name, id] = line.slice('from: '.length).split('\t');
      fromName = name ?? '';
      fromId = id ?? '';
    } else if (line.startsWith('workspace: ')) {
      workspace = line.slice('workspace: '.length);
    } else if (line.startsWith('reply_to: ')) {
      // The value is followed by a tab and the short reply hint meant for the
      // agent; the UI only needs the address.
      replyTo = line.slice('reply_to: '.length).split('\t')[0] ?? '';
    }
  }

  if (!fromId) {
    // Present but unparseable — treat as an ordinary message rather than
    // rendering an empty badge.
    return { text: content, source: null };
  }

  return { text: block.text, source: { fromName, fromId, workspace, replyTo } };
}

/** Parse the outer sender of a session message or an MnP delegation/report. */
export function parseConversationSourceBlock(content: string): { text: string; source: SessionDeliverySource | null } {
  if (!content.startsWith('[[MNP_CONVERSATION_SOURCE]]')) return parseSessionMessageBlock(content);

  // Only the leading envelope identifies the sender. Quoted child results can
  // contain their own envelopes and must not replace the outer source.
  const block = /^\[\[MNP_CONVERSATION_SOURCE\]\]\r?\n([^\r\n]+)\r?\n\[\[\/MNP_CONVERSATION_SOURCE\]\](?:\r?\n|$)/.exec(
    content
  );
  const unchanged: { text: string; source: null } = { text: content, source: null };
  if (!block) return unchanged;
  try {
    const data: unknown = JSON.parse(block[1]);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return unchanged;
    const source = data as Record<string, unknown>;
    if (
      (source.kind !== 'delegation' && source.kind !== 'report') ||
      typeof source.conversationId !== 'string' ||
      !source.conversationId.trim() ||
      (source.name !== undefined && typeof source.name !== 'string')
    )
      return unchanged;

    const fromId = source.conversationId.trim();
    let externalUrl: string | null | undefined;
    if (source.externalUrl === null) {
      externalUrl = null;
    } else if (source.externalUrl !== undefined) {
      if (typeof source.externalUrl !== 'string') return unchanged;
      const url = new URL(source.externalUrl);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.hash !== `#/conversation/${encodeURIComponent(fromId)}`
      )
        return unchanged;
      externalUrl = url.toString();
    }
    return {
      text: content.slice(block[0].length).trim(),
      source: {
        fromId,
        fromName: typeof source.name === 'string' ? source.name.trim() : '',
        workspace: '',
        replyTo: '',
        ...(externalUrl !== undefined ? { externalUrl } : {}),
      },
    };
  } catch {
    return unchanged;
  }
}
