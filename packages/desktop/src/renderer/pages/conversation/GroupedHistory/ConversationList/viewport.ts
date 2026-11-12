/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

type ListRegistration = {
  element: HTMLElement;
  update: (top: number, height: number) => void;
  offsetOf: (id: string) => number | undefined;
  scrollMargin: () => number;
};

/**
 * Switch for sidebar row virtualization. When on, only rows near the viewport
 * are mounted, which keeps long lists light but briefly shows empty space
 * while scrolling fast. Turned off for now; set to `true` to enable it again.
 * Scroll tracking and revealing offscreen conversations work either way.
 */
export const CONVERSATION_LIST_VIRTUALIZATION_ENABLED = false;

const ROW_HEIGHT = 34;
const OVERSCAN_ROWS = 6;

/** Compute the visible range within a fixed-height conversation block. */
export function getVisibleRange(count: number, stride: number, top: number, height: number) {
  if (height <= 0) return { start: 0, end: 0 };
  const start = Math.max(0, Math.min(count, Math.floor(top / stride) - OVERSCAN_ROWS));
  const end = Math.max(start, Math.min(count, Math.ceil((top + height) / stride) + OVERSCAN_ROWS));
  return { start, end };
}

// All project/timeline blocks share one scroll listener and one animation frame.
// Only block rectangles are measured; conversation rows never need measuring.
const viewports = new Map<HTMLElement, HistoryViewport>();

class HistoryViewport {
  private lists = new Set<ListRegistration>();
  private roots = new Map<Element, number>();
  private frame: number | undefined;
  private observer = new ResizeObserver(() => this.refresh());

  constructor(private scroller: HTMLElement) {
    this.observer.observe(scroller);
    scroller.addEventListener('scroll', this.refresh, { passive: true });
    window.addEventListener('resize', this.refresh);
  }

  refresh = (): void => {
    if (this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.measure();
    });
  };

  private measure(): void {
    const top = this.scroller.getBoundingClientRect().top + this.scroller.clientTop;
    const height = this.scroller.clientHeight;
    // Finish layout reads before notifying React consumers.
    const measurements = [...this.lists].map((list) => ({
      list,
      top: top - list.element.getBoundingClientRect().top,
    }));
    for (const measurement of measurements) measurement.list.update(measurement.top, height);
  }

  register(list: ListRegistration): () => void {
    this.lists.add(list);
    // Observe the entire content so async siblings (teams, filters, headers)
    // invalidate offsets too, without observing every mounted row.
    let root: Element = list.element;
    while (root.parentElement && root.parentElement !== this.scroller) root = root.parentElement;
    this.roots.set(root, (this.roots.get(root) ?? 0) + 1);
    this.observer.observe(root);
    this.refresh();

    return () => {
      this.lists.delete(list);
      const remaining = (this.roots.get(root) ?? 1) - 1;
      if (remaining > 0) this.roots.set(root, remaining);
      else {
        this.roots.delete(root);
        this.observer.unobserve(root);
      }
      if (this.lists.size > 0) this.refresh();
      else {
        this.observer.disconnect();
        this.scroller.removeEventListener('scroll', this.refresh);
        window.removeEventListener('resize', this.refresh);
        if (this.frame !== undefined) cancelAnimationFrame(this.frame);
        viewports.delete(this.scroller);
      }
    };
  }

  reveal(id: string): boolean {
    for (const list of this.lists) {
      const offset = list.offsetOf(id);
      if (offset === undefined) continue;
      const height = this.scroller.clientHeight;
      if (height <= 0) return false;
      const top =
        list.element.getBoundingClientRect().top -
        this.scroller.getBoundingClientRect().top -
        this.scroller.clientTop +
        this.scroller.scrollTop +
        offset;
      const margin = Math.min(list.scrollMargin(), Math.max(0, height - ROW_HEIGHT));
      let nextTop = this.scroller.scrollTop;
      if (top < nextTop + margin) nextTop = top - margin;
      else if (top + ROW_HEIGHT > nextTop + height) nextTop = top + ROW_HEIGHT - height;
      // Jump directly to offscreen targets: their DOM nodes do not exist yet.
      this.scroller.scrollTop = Math.max(0, Math.min(nextTop, this.scroller.scrollHeight - height));
      this.measure();
      return true;
    }
    return false;
  }
}

/** Register a block in the sidebar's shared viewport. */
export function registerConversationList(list: ListRegistration) {
  const scroller = list.element.closest<HTMLElement>('[data-conversation-scroll]');
  if (!scroller) {
    // Standalone consumers have no scroll viewport; keep their initial render bounded.
    list.update(0, ROW_HEIGHT * 12);
    return { refresh: () => {}, dispose: () => {} };
  }
  let viewport = viewports.get(scroller);
  if (!viewport) {
    viewport = new HistoryViewport(scroller);
    viewports.set(scroller, viewport);
  }
  return { refresh: viewport.refresh, dispose: viewport.register(list) };
}

/** Reveal an active conversation even when its virtual row is not mounted. */
export function scrollConversationIntoView(id: string): void {
  for (const viewport of viewports.values()) {
    if (viewport.reveal(id)) return;
  }
  document.getElementById('c-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
