/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useLayoutEffect, useRef, useState } from 'react';
import { CONVERSATION_LIST_VIRTUALIZATION_ENABLED, getVisibleRange, registerConversationList } from './viewport';

export { scrollConversationIntoView } from './viewport';
export { default as SortableConversationRow } from './SortableConversationRow';

type ConversationListProps<T> = {
  items: readonly T[];
  renderRow: (item: T) => React.ReactNode;
  /** Keep an open menu or active drag mounted until the interaction ends. */
  retainedIds?: readonly (string | null)[];
  rowGap?: number;
  scrollMargin?: number;
};

/** Render only rows near the shared sidebar viewport, retaining the full scroll height. */
export default function ConversationList<T extends { id: string }>({
  items,
  renderRow,
  retainedIds = [],
  rowGap = 2,
  scrollMargin = 64,
}: ConversationListProps<T>) {
  const element = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const stride = 34 + rowGap;
  const latest = useRef({ items, stride, scrollMargin });
  const registration = useRef<ReturnType<typeof registerConversationList> | null>(null);

  useLayoutEffect(() => {
    latest.current = { items, stride, scrollMargin };
    // Also catches offset changes when groups are reordered without changing height.
    registration.current?.refresh();
  });

  useLayoutEffect(() => {
    if (!element.current) return;
    registration.current = registerConversationList({
      element: element.current,
      update: (top, height) => {
        const next = getVisibleRange(latest.current.items.length, latest.current.stride, top, height);
        setRange((previous) => (previous.start === next.start && previous.end === next.end ? previous : next));
      },
      offsetOf: (id) => {
        const index = latest.current.items.findIndex((item) => item.id === id);
        return index < 0 ? undefined : index * latest.current.stride;
      },
      scrollMargin: () => latest.current.scrollMargin,
    });
    return () => {
      registration.current?.dispose();
      registration.current = null;
    };
  }, []);

  // With virtualization off every row stays mounted, so fast scrolling never shows empty space.
  const visible = CONVERSATION_LIST_VIRTUALIZATION_ENABLED ? range : { start: 0, end: items.length };
  const indices = new Set<number>();
  for (let index = visible.start; index < Math.min(items.length, visible.end); index++) indices.add(index);
  for (const id of retainedIds) {
    if (!id) continue;
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0) indices.add(index);
  }

  return (
    <div
      ref={element}
      className='relative min-w-0 shrink-0'
      data-virtual-conversation-list
      style={{ height: Math.max(0, items.length * stride - rowGap) }}
    >
      {[...indices]
        .toSorted((a, b) => a - b)
        .map((index) => (
          <div key={items[index].id} className='absolute inset-x-0 h-34px min-w-0' style={{ top: index * stride }}>
            {renderRow(items[index])}
          </div>
        ))}
    </div>
  );
}
