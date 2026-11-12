/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { TMessage } from '@/common/chat/chatLib';
import { isRecoveredMessageList } from './messageRecovery';

type Props = React.PropsWithChildren<{
  messages: TMessage[];
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  isScrollLocked?: () => boolean;
}>;

type ReadingAnchor = { key: string; offset: number };

/** Capture the reading position before recovery mutates the DOM, then restore it before paint. */
export class MessageRecoveryBoundary extends React.Component<Props, Record<string, never>, ReadingAnchor | null> {
  getSnapshotBeforeUpdate(previous: Props): ReadingAnchor | null {
    const { messages, scrollerRef, isScrollLocked } = this.props;
    const scroller = scrollerRef.current;
    if (previous.messages === messages || !isRecoveredMessageList(messages) || !scroller || isScrollLocked?.()) {
      return null;
    }
    // A reader following the latest output should continue following it.
    if (scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 4) return null;
    const viewport = scroller.getBoundingClientRect();
    for (const row of scroller.querySelectorAll<HTMLElement>('[data-message-render-key]')) {
      const rect = row.getBoundingClientRect();
      if (rect.bottom > viewport.top && rect.top < viewport.bottom) {
        return { key: row.dataset.messageRenderKey!, offset: rect.top - viewport.top };
      }
    }
    return null;
  }

  componentDidUpdate(_previous: Props, _state: Record<string, never>, anchor: ReadingAnchor | null): void {
    const scroller = this.props.scrollerRef.current;
    if (!anchor || !scroller || this.props.isScrollLocked?.()) return;
    const row = Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-render-key]')).find(
      (candidate) => candidate.dataset.messageRenderKey === anchor.key
    );
    if (row) {
      scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.offset;
    }
  }

  render(): React.ReactNode {
    return this.props.children;
  }
}
