/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { createBufferedEventRelay, findDeepLinkUrl } from '@/process/startup/bootstrap/protocol';

describe('findDeepLinkUrl', () => {
  it('returns the protocol argument without depending on its argv position', () => {
    expect(findDeepLinkUrl(['electron.exe', 'D:\\Git\\AionUi', 'aionui://navigate?route=%2Fguid'])).toBe(
      'aionui://navigate?route=%2Fguid'
    );
  });

  it('ignores unrelated or malformed arguments', () => {
    expect(findDeepLinkUrl(['electron.exe', 'https://aionui.example', 'aionui:navigate'])).toBeUndefined();
  });
});

describe('createBufferedEventRelay', () => {
  it('preserves queued event order and delivers later events immediately', () => {
    const relay = createBufferedEventRelay<string>();
    const consumer = vi.fn();
    relay.publish('first');
    relay.publish('second');

    relay.attach(consumer);
    relay.publish('third');

    expect(consumer.mock.calls.map(([event]) => event)).toEqual(['first', 'second', 'third']);
  });

  it('buffers reentrant publication until the current pending queue is drained', () => {
    const relay = createBufferedEventRelay<string>();
    const received: string[] = [];
    relay.publish('first');
    relay.publish('second');

    relay.attach((event) => {
      received.push(event);
      if (event === 'first') relay.publish('nested');
    });

    expect(received).toEqual(['first', 'second', 'nested']);
  });

  it('rejects competing consumers instead of duplicating delivery', () => {
    const relay = createBufferedEventRelay<string>();
    relay.attach(() => {});

    expect(() => relay.attach(() => {})).toThrow('already has a consumer');
  });
});
