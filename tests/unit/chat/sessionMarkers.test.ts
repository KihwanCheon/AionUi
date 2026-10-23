/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  parseConversationSourceBlock,
  parseSessionMessageBlock,
  parseSessionsBlock,
} from '@/renderer/pages/conversation/Messages/components/sessionMarkers';

const envelope = (source: unknown, body = '# Work request\n\nKeep this body.') =>
  `[[MNP_CONVERSATION_SOURCE]]\n${JSON.stringify(source)}\n[[/MNP_CONVERSATION_SOURCE]]\n\n${body}`;

describe('parseSessionsBlock', () => {
  it('strips the block from the visible text and returns the chips', () => {
    const content = [
      '问下他那边接口定完了没',
      '',
      '[[AION_SESSIONS]]',
      '重构-鉴权模块\tconv_1\tworkspace: same',
      '[[/AION_SESSIONS]]',
    ].join('\n');
    const parsed = parseSessionsBlock(content);
    expect(parsed.text).toBe('问下他那边接口定完了没');
    expect(parsed.sessions).toEqual([{ name: '重构-鉴权模块', id: 'conv_1', workspace: 'same' }]);
  });

  it('never leaves a bare marker in the rendered text', () => {
    // The backend persists the block VERBATIM into the user's own message, so
    // failing to strip it shows raw markers in the sender's own bubble.
    const content = 'hi\n\n[[AION_SESSIONS]]\nA\tconv_1\tworkspace: same\n[[/AION_SESSIONS]]';
    expect(parseSessionsBlock(content).text).not.toContain('AION_SESSIONS');
  });

  it('leaves a message without the block untouched', () => {
    expect(parseSessionsBlock('plain text')).toEqual({ text: 'plain text', sessions: [] });
  });

  it('parses several targets', () => {
    const content = [
      'hi',
      '',
      '[[AION_SESSIONS]]',
      'A\tconv_1\tworkspace: same',
      'B\tconv_2\tworkspace: /w/b（与你不同）',
      '[[/AION_SESSIONS]]',
    ].join('\n');
    const parsed = parseSessionsBlock(content);
    expect(parsed.sessions).toEqual([
      { name: 'A', id: 'conv_1', workspace: 'same' },
      { name: 'B', id: 'conv_2', workspace: '/w/b（与你不同）' },
    ]);
  });

  it('does not swallow content when the closing marker is missing', () => {
    // A truncated block must degrade to showing the text, not eat the message.
    const content = 'hi\n\n[[AION_SESSIONS]]\nA\tconv_1\tworkspace: same';
    const parsed = parseSessionsBlock(content);
    expect(parsed.sessions).toEqual([]);
    expect(parsed.text).toBe(content);
  });

  it('skips malformed lines rather than producing half-built chips', () => {
    const content = [
      'hi',
      '',
      '[[AION_SESSIONS]]',
      'no tabs here',
      'A\tconv_1\tworkspace: same',
      '[[/AION_SESSIONS]]',
    ].join('\n');
    expect(parseSessionsBlock(content).sessions).toEqual([{ name: 'A', id: 'conv_1', workspace: 'same' }]);
  });

  it('handles an empty block', () => {
    const content = 'hi\n\n[[AION_SESSIONS]]\n[[/AION_SESSIONS]]';
    const parsed = parseSessionsBlock(content);
    expect(parsed.sessions).toEqual([]);
    expect(parsed.text).toBe('hi');
  });
});

describe('parseConversationSourceBlock', () => {
  it.each(['delegation', 'report'])('extracts the sender of an MnP %s without changing its body', (kind) => {
    const body = '# Work request\n\nKeep this body.';
    const result = parseConversationSourceBlock(
      envelope({ kind, conversationId: 'source-1', name: '발신 대화' }, body)
    );
    expect(result.text).toBe(body);
    expect(result.source).toEqual({ fromId: 'source-1', fromName: '발신 대화', workspace: '', replyTo: '' });
  });

  it.each([
    null,
    [],
    { kind: 'report', name: 'Missing ID' },
    { kind: 'report', conversationId: '  ' },
    { kind: 'unknown', conversationId: 'source-1' },
    { kind: 'delegation', conversationId: 'source-1', name: {} },
    { kind: 'report', conversationId: 'source-1', externalUrl: {} },
  ])('preserves malformed metadata as ordinary text: %j', (source) => {
    const content = envelope(source);
    expect(parseConversationSourceBlock(content)).toEqual({ text: content, source: null });
  });

  it.each([
    '[[MNP_CONVERSATION_SOURCE]]\n{broken json}\n[[/MNP_CONVERSATION_SOURCE]]\nbody',
    '[[MNP_CONVERSATION_SOURCE]]\n{"kind":"report","conversationId":"source-1"}',
  ])('preserves invalid JSON and truncated envelopes', (content) => {
    expect(parseConversationSourceBlock(content)).toEqual({ text: content, source: null });
  });

  it('does not treat a quoted source or nested session delivery as the outer sender', () => {
    const quoted = envelope({ kind: 'delegation', conversationId: 'nested', name: 'Nested sender' });
    const body = `# Report\n${quoted}\n[[AION_SESSION_MESSAGE]]\nfrom: Other\tother-id\n[[/AION_SESSION_MESSAGE]]`;
    const content = envelope({ kind: 'report', conversationId: 'child-1', name: 'Reporting child' }, body);
    expect(parseConversationSourceBlock(`Example:\n${quoted}`)).toEqual({ text: `Example:\n${quoted}`, source: null });
    expect(parseConversationSourceBlock(content).source?.fromId).toBe('child-1');
    expect(parseConversationSourceBlock(content).text).toBe(body);
  });

  it('handles closing-marker text in a title and Windows newlines', () => {
    const name = '대화 "제목" [[/MNP_CONVERSATION_SOURCE]]';
    const content = envelope({ kind: 'report', conversationId: 'child-1', name }).replaceAll('\n', '\r\n');
    expect(parseConversationSourceBlock(content).source?.fromName).toBe(name);
    expect(parseConversationSourceBlock(content).text).toBe('# Work request\r\n\r\nKeep this body.');
  });

  it('retains the source ID when title lookup failed', () => {
    expect(parseConversationSourceBlock(envelope({ kind: 'delegation', conversationId: 'parent-1' })).source).toEqual({
      fromId: 'parent-1',
      fromName: '',
      workspace: '',
      replyTo: '',
    });
  });

  it('keeps remote navigation distinct from an unavailable remote address', () => {
    const source = {
      kind: 'report',
      conversationId: 'child-1',
      externalUrl: 'http://sub.example:7777/#/conversation/child-1',
    };
    expect(parseConversationSourceBlock(envelope(source)).source?.externalUrl).toBe(source.externalUrl);
    expect(parseConversationSourceBlock(envelope({ ...source, externalUrl: null })).source?.externalUrl).toBeNull();
  });

  it.each([
    'javascript:alert(1)',
    'file:///C:/secrets#/conversation/child-1',
    'https://user:password@example.com/#/conversation/child-1',
    'https://example.com/#/conversation/different-id',
    '/conversation/child-1',
  ])('does not accept an unsafe or mismatched remote destination: %s', (externalUrl) => {
    const content = envelope({ kind: 'report', conversationId: 'child-1', externalUrl });
    expect(parseConversationSourceBlock(content)).toEqual({ text: content, source: null });
  });

  it('preserves the existing session-message source contract', () => {
    const content = '[[AION_SESSION_MESSAGE]]\nfrom: Sender\tsender-1\n[[/AION_SESSION_MESSAGE]]\nbody';
    expect(parseConversationSourceBlock(content)).toEqual(parseSessionMessageBlock(content));
  });
});

describe('parseSessionMessageBlock', () => {
  it('extracts the source and strips the block', () => {
    const content = [
      '[[AION_SESSION_MESSAGE]]',
      'from: 重构-鉴权模块\tconv_1',
      'workspace: same',
      'reply_to: conv_1\t（回信: session send-message, to=reply_to）',
      '[[/AION_SESSION_MESSAGE]]',
      '',
      '接口定完了吗？',
    ].join('\n');
    const parsed = parseSessionMessageBlock(content);
    expect(parsed.text).toBe('接口定完了吗？');
    expect(parsed.source).toEqual({
      fromName: '重构-鉴权模块',
      fromId: 'conv_1',
      workspace: 'same',
      replyTo: 'conv_1',
    });
  });

  it('returns a null source for an ordinary message', () => {
    expect(parseSessionMessageBlock('hello').source).toBeNull();
  });

  it('keeps a cross-workspace warning value intact', () => {
    const content = [
      '[[AION_SESSION_MESSAGE]]',
      'from: A\tconv_1',
      'workspace: /w/a（与你不同，勿用相对路径，勿假设可读）',
      'reply_to: conv_1\t（回信: session send-message, to=reply_to）',
      '[[/AION_SESSION_MESSAGE]]',
      '',
      'body',
    ].join('\n');
    expect(parseSessionMessageBlock(content).source?.workspace).toContain('与你不同');
  });

  it('does not swallow the body when the closing marker is missing', () => {
    const content = '[[AION_SESSION_MESSAGE]]\nfrom: A\tconv_1\nworkspace: same';
    const parsed = parseSessionMessageBlock(content);
    expect(parsed.source).toBeNull();
    expect(parsed.text).toBe(content);
  });

  it('leaves a multi-line body intact', () => {
    const content = [
      '[[AION_SESSION_MESSAGE]]',
      'from: A\tconv_1',
      'workspace: same',
      'reply_to: conv_1\t（回信）',
      '[[/AION_SESSION_MESSAGE]]',
      '',
      'line one',
      'line two',
    ].join('\n');
    expect(parseSessionMessageBlock(content).text).toBe('line one\nline two');
  });

  it('never leaves a bare marker in the rendered text', () => {
    const content = [
      '[[AION_SESSION_MESSAGE]]',
      'from: A\tconv_1',
      'workspace: same',
      'reply_to: conv_1\t（回信）',
      '[[/AION_SESSION_MESSAGE]]',
      '',
      'body',
    ].join('\n');
    expect(parseSessionMessageBlock(content).text).not.toContain('AION_SESSION_MESSAGE');
  });
});

describe('the two markers do not interfere', () => {
  it('a delivered message that itself used `@@` renders both parts', () => {
    // B receives a delivery, and A's original message carried its own
    // `[[AION_SESSIONS]]` block. Both must resolve.
    const content = [
      '[[AION_SESSION_MESSAGE]]',
      'from: A\tconv_1',
      'workspace: same',
      'reply_to: conv_1\t（回信）',
      '[[/AION_SESSION_MESSAGE]]',
      '',
      'ask them',
      '',
      '[[AION_SESSIONS]]',
      'C\tconv_3\tworkspace: same',
      '[[/AION_SESSIONS]]',
    ].join('\n');
    const delivered = parseSessionMessageBlock(content);
    expect(delivered.source?.fromId).toBe('conv_1');
    const mentions = parseSessionsBlock(delivered.text);
    expect(mentions.sessions).toEqual([{ name: 'C', id: 'conv_3', workspace: 'same' }]);
    expect(mentions.text).toBe('ask them');
  });
});
