/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const AIONUI_PROTOCOL_SCHEME = 'aionui';

export type BootstrapProtocolEvent =
  | { kind: 'open-url'; deepLinkUrl: string }
  | { kind: 'second-instance'; deepLinkUrl?: string };

export type AionUiBootstrapContext = {
  attachProtocolHandler: (handler: (event: BootstrapProtocolEvent) => void) => () => void;
  ownsSingleInstanceLock: true;
};

export function findDeepLinkUrl(argv: readonly string[]): string | undefined {
  return argv.find((arg) => arg.startsWith(`${AIONUI_PROTOCOL_SCHEME}://`));
}

export type BufferedEventRelay<T> = {
  attach: (consumer: (event: T) => void) => () => void;
  publish: (event: T) => void;
};

/** Buffer events until a consumer is attached, then preserve FIFO delivery. */
export function createBufferedEventRelay<T>(): BufferedEventRelay<T> {
  const pending: T[] = [];
  let consumer: ((event: T) => void) | null = null;
  let draining = false;

  return {
    attach(nextConsumer) {
      if (consumer) {
        throw new Error('A buffered event relay already has a consumer');
      }

      consumer = nextConsumer;
      draining = true;
      try {
        while (pending.length > 0) {
          nextConsumer(pending.shift()!);
        }
      } finally {
        draining = false;
      }

      return () => {
        if (consumer === nextConsumer) consumer = null;
      };
    },
    publish(event) {
      if (!consumer || draining) {
        pending.push(event);
        return;
      }
      consumer(event);
    },
  };
}
