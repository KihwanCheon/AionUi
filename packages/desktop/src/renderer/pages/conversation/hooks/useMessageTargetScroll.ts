/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef } from 'react';
import { USER_CHOICE_MARKER } from '@/renderer/hooks/context/UserChoiceNotifications/protocol';

type ElementRef = { readonly current: HTMLElement | null };

/** Locate a question box or legacy prose marker, including open Markdown shadow roots. */
function findMarkerTarget(root: HTMLElement, markerIndex: number): Element | Range | undefined {
  let index = 0;
  const visit = (node: Node): Element | Range | undefined => {
    if (node instanceof Element && node.matches('pre, code, blockquote')) return;
    if (node instanceof Element && node.getAttribute('data-choice-marker-index') === String(markerIndex)) return node;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      let offset = 0;
      for (const line of text.split('\n')) {
        if (line.trim() === USER_CHOICE_MARKER && index++ === markerIndex) {
          const range = document.createRange();
          const start = offset + line.indexOf(USER_CHOICE_MARKER);
          range.setStart(node, start);
          range.setEnd(node, start + USER_CHOICE_MARKER.length);
          return range;
        }
        offset += line.length + 1;
      }
    }
    const children = node instanceof Element && node.shadowRoot ? node.shadowRoot.childNodes : node.childNodes;
    for (const child of children) {
      const range = visit(child);
      if (range) return range;
    }
  };
  return visit(root);
}

/** Keep a requested message/marker in view as history, Markdown and images settle. */
export function useMessageTargetScroll({
  scrollerRef,
  contentRef,
  navigationKey,
}: {
  scrollerRef: ElementRef;
  contentRef: ElementRef;
  navigationKey: string;
}) {
  const cleanupRef = useRef<(() => void) | undefined>(undefined);
  const isActive = useCallback(() => cleanupRef.current !== undefined, []);
  const cancel = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = undefined;
  }, []);

  useEffect(() => cancel, [cancel, navigationKey]);

  const start = useCallback(
    (element: HTMLElement, markerIndex?: number): boolean => {
      cancel();
      const scroller = scrollerRef.current;
      const content = contentRef.current;
      if (!scroller || !content || !content.contains(element)) return false;

      const elementId = element.id;
      let frame: number | undefined;
      const observedRoots = new WeakSet<ShadowRoot>();
      const align = () => {
        frame = undefined;
        const target = document.getElementById(elementId);
        if (!target || !content.contains(target)) return;
        // Shadow portals can mount after the row. Observe their text as well as
        // outer layout; a marker may appear without changing the total height.
        for (const host of target.querySelectorAll('*')) {
          if (host.shadowRoot && !observedRoots.has(host.shadowRoot)) {
            observedRoots.add(host.shadowRoot);
            mutations.observe(host.shadowRoot, { childList: true, subtree: true, characterData: true });
          }
        }
        const marker = markerIndex === undefined ? undefined : findMarkerTarget(target, markerIndex);
        const targetRect = marker?.getBoundingClientRect() ?? target.getBoundingClientRect();
        // Keep the question heading visible even when its body exceeds the viewport.
        const targetHeight =
          markerIndex !== undefined && (!marker || marker instanceof Element) ? 0 : targetRect.height;
        const viewport = scroller.getBoundingClientRect();
        const top = Math.max(
          0,
          Math.min(
            scroller.scrollHeight - scroller.clientHeight,
            scroller.scrollTop +
              targetRect.top +
              targetHeight / 2 -
              viewport.top -
              scroller.clientTop -
              scroller.clientHeight / 2
          )
        );
        // A local instant scroll has no in-flight animation to race subsequent
        // layout corrections and cannot move ancestors outside the chat pane.
        if (Math.abs(scroller.scrollTop - top) > 1) scroller.scrollTo({ top, behavior: 'instant' });
      };
      const schedule = () => {
        if (frame === undefined) frame = requestAnimationFrame(align);
      };
      const resize = new ResizeObserver(schedule);
      const mutations = new MutationObserver(schedule);
      const onKeyDown = (event: KeyboardEvent) => {
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancel();
      };
      cleanupRef.current = () => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        resize.disconnect();
        mutations.disconnect();
        scroller.removeEventListener('wheel', cancel);
        scroller.removeEventListener('pointerdown', cancel);
        scroller.removeEventListener('touchstart', cancel);
        scroller.removeEventListener('keydown', onKeyDown);
      };
      scroller.addEventListener('wheel', cancel, { passive: true });
      scroller.addEventListener('pointerdown', cancel, { passive: true });
      scroller.addEventListener('touchstart', cancel, { passive: true });
      scroller.addEventListener('keydown', onKeyDown);
      resize.observe(scroller);
      resize.observe(content);
      resize.observe(element);
      mutations.observe(content, { childList: true, subtree: true, characterData: true });
      align();
      return true;
    },
    [cancel, contentRef, scrollerRef]
  );

  return { start, cancel, isActive };
}
