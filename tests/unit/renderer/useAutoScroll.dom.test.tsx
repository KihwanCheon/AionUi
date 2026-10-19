/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { UIEvent } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TMessage } from '@/common/chat/chatLib';
import { useAutoScroll } from '@/renderer/pages/conversation/Messages/useAutoScroll';
import { useMessageTargetScroll } from '@/renderer/pages/conversation/hooks/useMessageTargetScroll';

let resizeObserverCallback: ResizeObserverCallback | null = null;

class ResizeObserverMock {
  constructor(callback: ResizeObserverCallback) {
    resizeObserverCallback = callback;
  }

  observe() {}
  unobserve() {}
  disconnect() {
    resizeObserverCallback = null;
  }
}

global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

function createLeftMessage(content: string): TMessage {
  return {
    id: 'left-message',
    msg_id: 'left-message',
    conversation_id: 'conversation-1',
    type: 'text',
    position: 'left',
    content: {
      content,
    },
    created_at: 1,
  } as TMessage;
}

function createRightMessage(content: string): TMessage {
  return {
    id: 'right-message',
    msg_id: 'right-message',
    conversation_id: 'conversation-1',
    type: 'text',
    position: 'right',
    content: {
      content,
    },
    created_at: 1,
  } as TMessage;
}

function createScroller({
  scrollTop = 520,
  scrollHeight = 1000,
  clientHeight = 400,
}: {
  scrollTop?: number;
  scrollHeight?: number;
  clientHeight?: number;
} = {}): HTMLDivElement {
  const scroller = document.createElement('div');
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    writable: true,
    value: scrollTop,
  });
  Object.defineProperty(scroller, 'scrollHeight', {
    configurable: true,
    writable: true,
    value: scrollHeight,
  });
  Object.defineProperty(scroller, 'clientHeight', {
    configurable: true,
    writable: true,
    value: clientHeight,
  });
  scroller.scrollTo = vi.fn(({ top }: ScrollToOptions) => {
    if (typeof top === 'number') {
      scroller.scrollTop = top;
    }
  });
  return scroller;
}

function createContent(): HTMLDivElement {
  return document.createElement('div');
}

describe('question target scrolling', () => {
  let scroller: HTMLDivElement;
  let content: HTMLDivElement;
  let message: HTMLDivElement;

  beforeEach(() => {
    scroller = createScroller({ scrollTop: 0, scrollHeight: 5000, clientHeight: 400 });
    content = createContent();
    message = document.createElement('div');
    message.id = 'target-question-message';
    scroller.appendChild(content);
    content.appendChild(message);
    document.body.appendChild(scroller);
    scroller.getBoundingClientRect = () => new DOMRect(0, 0, 400, 400);
    message.getBoundingClientRect = () => new DOMRect(0, 100 - scroller.scrollTop, 400, 3000);
  });

  afterEach(() => {
    scroller.remove();
    vi.restoreAllMocks();
  });

  const useTarget = () =>
    useMessageTargetScroll({
      scrollerRef: { current: scroller },
      contentRef: { current: content },
      navigationKey: 'question-target',
    });

  it.each([false, true])('centers the requested box heading, including tall boxes (shadow: %s)', (shadow) => {
    const root = shadow ? message.attachShadow({ mode: 'open' }) : message;
    for (const index of [0, 1]) {
      const box = document.createElement('section');
      box.setAttribute('data-choice-marker-index', String(index));
      box.getBoundingClientRect = () => new DOMRect(0, 600 + index * 800 - scroller.scrollTop, 300, 1600);
      root.appendChild(box);
    }
    const { result } = renderHook(useTarget);
    act(() => {
      result.current.start(message, 1);
    });

    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: 'instant' });
    expect(result.current.isActive()).toBe(true);
  });

  it('retains the legacy marker target while excluding quoted examples', () => {
    const quote = document.createElement('blockquote');
    quote.textContent = '[[AIONUI_USER_CHOICE_REQUIRED]]';
    const prose = document.createElement('p');
    prose.textContent = '[[AIONUI_USER_CHOICE_REQUIRED]]\nQuestion?';
    message.append(quote, prose);
    const range = document.createRange();
    range.getBoundingClientRect = () => new DOMRect(0, 700 - scroller.scrollTop, 150, 16);
    vi.spyOn(document, 'createRange').mockReturnValue(range);
    const { result } = renderHook(useTarget);
    act(() => {
      result.current.start(message, 0);
    });

    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 508, behavior: 'instant' });
    expect(range.startContainer.parentElement).toBe(prose);
  });

  it('does not start scrolling to a message outside the conversation', () => {
    const { result } = renderHook(useTarget);
    expect(result.current.start(document.createElement('div'), 0)).toBe(false);
    expect(scroller.scrollTo).not.toHaveBeenCalled();
  });
});

function attachElements(
  result: ReturnType<typeof renderHook<typeof useAutoScroll>>['result'],
  scroller: HTMLDivElement,
  content: HTMLDivElement
): void {
  act(() => {
    result.current.handleScrollerRef(scroller);
    result.current.handleContentRef(content);
  });
}

function fireScroll(
  handleScroll: (event: UIEvent<HTMLDivElement>) => void,
  scroller: HTMLDivElement,
  nextScrollTop: number
): void {
  scroller.scrollTop = nextScrollTop;
  act(() => {
    handleScroll({
      currentTarget: scroller,
    } as UIEvent<HTMLDivElement>);
  });
}

describe('useAutoScroll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T12:00:00.000Z'));
    resizeObserverCallback = null;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('auto-follows to the bottom when content height changes and the user is still following output', () => {
    const scroller = createScroller();
    const content = createContent();
    const { result } = renderHook(() =>
      useAutoScroll({
        messages: [createLeftMessage('hello')],
        itemCount: 1,
      })
    );

    attachElements(result, scroller, content);

    act(() => {
      resizeObserverCallback?.([], {} as ResizeObserver);
      vi.runAllTimers();
    });

    expect(scroller.scrollTo).toHaveBeenCalledWith({
      top: 600,
      behavior: 'auto',
    });
  });

  it('auto-follows assistant message updates even when resize observer does not fire', () => {
    const scroller = createScroller({ scrollTop: 600 });
    const content = createContent();
    const { result, rerender } = renderHook(
      ({ messages }) =>
        useAutoScroll({
          messages,
          itemCount: messages.length,
        }),
      {
        initialProps: {
          messages: [createLeftMessage('hello')] as TMessage[],
        },
      }
    );

    attachElements(result, scroller, content);
    act(() => {
      vi.runAllTimers();
    });
    vi.mocked(scroller.scrollTo).mockClear();

    scroller.scrollHeight = 1080;
    act(() => {
      rerender({
        messages: [createLeftMessage('hello world'.repeat(8))],
      });
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(scroller.scrollTo).toHaveBeenCalledWith({
      top: 680,
      behavior: 'auto',
    });
  });

  it('auto-follows newly appended assistant messages without forcing manual scroll state', () => {
    const scroller = createScroller({ scrollTop: 600 });
    const content = createContent();
    const nextAssistantMessage = {
      ...createLeftMessage('new assistant reply'),
      id: 'left-message-2',
      msg_id: 'left-message-2',
      created_at: 2,
    };
    const { result, rerender } = renderHook(
      ({ messages }) =>
        useAutoScroll({
          messages,
          itemCount: messages.length,
        }),
      {
        initialProps: {
          messages: [createLeftMessage('hello')] as TMessage[],
        },
      }
    );

    attachElements(result, scroller, content);
    act(() => {
      vi.runAllTimers();
    });
    vi.mocked(scroller.scrollTo).mockClear();

    scroller.scrollHeight = 1080;
    act(() => {
      rerender({
        messages: [createLeftMessage('hello'), nextAssistantMessage],
      });
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(scroller.scrollTo).toHaveBeenCalledWith({
      top: 680,
      behavior: 'auto',
    });
  });

  it('does not auto-follow after the user scrolls up', () => {
    const scroller = createScroller({ scrollTop: 600 });
    const content = createContent();
    const { result } = renderHook(() =>
      useAutoScroll({
        messages: [createLeftMessage('hello')],
        itemCount: 1,
      })
    );

    attachElements(result, scroller, content);
    act(() => {
      vi.runAllTimers();
    });
    vi.mocked(scroller.scrollTo).mockClear();

    fireScroll(result.current.handleScroll, scroller, 600);
    vi.setSystemTime(new Date('2026-05-26T12:00:00.250Z'));
    fireScroll(result.current.handleScroll, scroller, 480);

    act(() => {
      resizeObserverCallback?.([], {} as ResizeObserver);
      vi.runAllTimers();
    });

    expect(scroller.scrollTo).not.toHaveBeenCalledWith({
      top: 600,
      behavior: 'auto',
    });
    expect(result.current.showScrollButton).toBe(true);
  });

  it('does not auto-follow after the user manually scrolls while remaining away from the bottom', () => {
    const scroller = createScroller({ scrollTop: 600 });
    const content = createContent();
    const { result } = renderHook(() =>
      useAutoScroll({
        messages: [createLeftMessage('hello')],
        itemCount: 1,
      })
    );

    attachElements(result, scroller, content);
    act(() => {
      vi.runAllTimers();
    });
    vi.mocked(scroller.scrollTo).mockClear();

    fireScroll(result.current.handleScroll, scroller, 240);
    vi.setSystemTime(new Date('2026-05-26T12:00:00.250Z'));
    fireScroll(result.current.handleScroll, scroller, 260);

    act(() => {
      resizeObserverCallback?.([], {} as ResizeObserver);
      vi.runAllTimers();
    });

    expect(scroller.scrollTo).not.toHaveBeenCalledWith({
      top: 600,
      behavior: 'auto',
    });
    expect(result.current.showScrollButton).toBe(true);
  });

  it('treats wheel-driven user scroll as manual intervention even inside the programmatic guard window', () => {
    const scroller = createScroller({ scrollTop: 600 });
    const content = createContent();
    const { result } = renderHook(() =>
      useAutoScroll({
        messages: [createLeftMessage('hello')],
        itemCount: 1,
      })
    );

    attachElements(result, scroller, content);
    act(() => {
      vi.runAllTimers();
    });
    vi.mocked(scroller.scrollTo).mockClear();

    act(() => {
      result.current.handleWheel({
        deltaX: 0,
        deltaY: -320,
      } as React.WheelEvent<HTMLDivElement>);
    });
    fireScroll(result.current.handleScroll, scroller, 260);

    act(() => {
      resizeObserverCallback?.([], {} as ResizeObserver);
      vi.runAllTimers();
    });

    expect(scroller.scrollTo).not.toHaveBeenCalledWith({
      top: 600,
      behavior: 'auto',
    });
    expect(result.current.showScrollButton).toBe(true);
  });

  it('forces a bottom sync when a new user message is appended', () => {
    const scroller = createScroller();
    const content = createContent();
    const { result, rerender } = renderHook(
      ({ messages }) =>
        useAutoScroll({
          messages,
          itemCount: messages.length,
        }),
      {
        initialProps: {
          messages: [createLeftMessage('hello')] as TMessage[],
        },
      }
    );

    attachElements(result, scroller, content);
    act(() => {
      vi.runAllTimers();
    });
    vi.mocked(scroller.scrollTo).mockClear();

    act(() => {
      rerender({
        messages: [createLeftMessage('hello'), createRightMessage('question')],
      });
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(scroller.scrollTo).toHaveBeenCalledWith({
      top: 600,
      behavior: 'auto',
    });
  });

  it('does not treat prepended history as a new user message', () => {
    const scroller = createScroller({ scrollTop: 600 });
    const content = createContent();
    const currentUserMessage = createRightMessage('question');
    const { result, rerender } = renderHook(
      ({ messages }) =>
        useAutoScroll({
          messages,
          itemCount: messages.length,
        }),
      {
        initialProps: {
          messages: [currentUserMessage] as TMessage[],
        },
      }
    );

    attachElements(result, scroller, content);
    act(() => {
      vi.runAllTimers();
    });
    vi.mocked(scroller.scrollTo).mockClear();

    act(() => {
      result.current.handleWheel({ deltaX: 0, deltaY: -320 } as React.WheelEvent<HTMLDivElement>);
    });
    fireScroll(result.current.handleScroll, scroller, 120);

    scroller.scrollHeight = 1400;
    act(() => {
      rerender({
        messages: [createLeftMessage('older reply'), { ...currentUserMessage }],
      });
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(scroller.scrollTo).not.toHaveBeenCalled();
  });

  it('scrolls a target element into view for explicit message jumps', () => {
    const { result } = renderHook(() =>
      useAutoScroll({
        messages: [createLeftMessage('hello')],
        itemCount: 1,
      })
    );
    const target = document.createElement('div');
    target.scrollIntoView = vi.fn();

    act(() => {
      result.current.scrollElementIntoView(target, {
        behavior: 'smooth',
        block: 'center',
      });
    });

    expect(target.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    });
  });

  it('keeps bottom resizes from overriding a notification until bottom-follow is explicitly resumed', () => {
    let locked = true;
    const scroller = createScroller({ scrollTop: 600 });
    const content = createContent();
    const { result } = renderHook(() =>
      useAutoScroll({
        messages: [createLeftMessage('reply')],
        itemCount: 1,
        isScrollLocked: () => locked,
        onAutoFollowResumed: () => {
          locked = false;
        },
      })
    );
    attachElements(result, scroller, content);
    act(() => {
      resizeObserverCallback?.([], {} as ResizeObserver);
      vi.runAllTimers();
    });
    scroller.scrollHeight = 1400;
    act(() => {
      resizeObserverCallback?.([], {} as ResizeObserver);
      vi.runAllTimers();
    });
    expect(scroller.scrollTop).toBe(600);

    act(() => result.current.scrollToBottom('auto'));
    expect(scroller.scrollTop).toBe(1000);
    expect(locked).toBe(false);
  });
});
