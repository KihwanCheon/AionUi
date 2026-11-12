import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConversationList, {
  scrollConversationIntoView,
} from '@/renderer/pages/conversation/GroupedHistory/ConversationList';

vi.mock('@/renderer/pages/conversation/GroupedHistory/ConversationList/SortableConversationRow', () => ({
  default: () => null,
}));
// These cases cover the virtualized path, which is switched off by default.
vi.mock('@/renderer/pages/conversation/GroupedHistory/ConversationList/viewport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/renderer/pages/conversation/GroupedHistory/ConversationList/viewport')>()),
  CONVERSATION_LIST_VIRTUALIZATION_ENABLED: true,
}));

const items = Array.from({ length: 814 }, (_, index) => ({ id: `row-${index}` }));
const row = (item: { id: string }) => (
  <div id={`c-${item.id}`} data-testid={item.id}>
    {item.id}
  </div>
);
let viewportHeight = 360;
const flush = async () => act(async () => vi.advanceTimersByTimeAsync(20));

function Fixture({
  retainedIds = [],
  count = 814,
  offset = 0,
}: {
  retainedIds?: string[];
  count?: number;
  offset?: number;
}) {
  return (
    <div data-conversation-scroll data-testid='scroller'>
      <div data-offset={offset}>
        <ConversationList items={items.slice(0, count)} renderRow={row} retainedIds={retainedIds} />
      </div>
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  viewportHeight = 360;
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-conversation-scroll') ? viewportHeight : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(40000);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const offset = Number(this.closest<HTMLElement>('[data-offset]')?.dataset.offset ?? 0);
    const scroller = this.closest<HTMLElement>('[data-conversation-scroll]');
    return new DOMRect(0, this === scroller ? 0 : offset - (scroller?.scrollTop ?? 0), 300, viewportHeight);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('sidebar conversation viewport', () => {
  it('mounts only nearby rows and keeps the full list height', async () => {
    const { container } = render(<Fixture />);
    await flush();
    expect(screen.getAllByTestId(/^row-/)).toHaveLength(16);
    expect(container.querySelector('[data-virtual-conversation-list]')).toHaveStyle({ height: '29302px' });
    expect(screen.queryByTestId('row-813')).toBeNull();
  });

  it('replaces mounted rows on scrolling instead of accumulating hidden rows', async () => {
    render(<Fixture />);
    await flush();
    const scroller = screen.getByTestId('scroller');
    scroller.scrollTop = 18000;
    fireEvent.scroll(scroller);
    await flush();
    expect(screen.getByTestId('row-500')).toBeInTheDocument();
    expect(screen.queryByTestId('row-0')).toBeNull();
    expect(screen.getAllByTestId(/^row-/)).toHaveLength(22);
  });

  it('reveals an unmounted target below the sticky project headers', async () => {
    render(<Fixture offset={200} />);
    await flush();
    act(() => scrollConversationIntoView('row-800'));
    await flush();
    expect(screen.getByTestId('row-800')).toBeInTheDocument();
    expect(screen.getByTestId('scroller').scrollTop).toBe(28674);
    expect(screen.getAllByTestId(/^row-/).length).toBeLessThan(25);
  });

  it('does not scroll or render a target excluded by the current filter', async () => {
    render(<Fixture count={5} />);
    await flush();
    act(() => scrollConversationIntoView('row-800'));
    expect(screen.queryByTestId('row-800')).toBeNull();
    expect(screen.getByTestId('scroller').scrollTop).toBe(0);
  });

  it('retains only the active drag or menu row and releases it when the interaction ends', async () => {
    const view = render(<Fixture retainedIds={['row-800']} />);
    await flush();
    expect(screen.getAllByTestId(/^row-/)).toHaveLength(17);
    view.rerender(<Fixture />);
    await flush();
    expect(screen.queryByTestId('row-800')).toBeNull();
  });

  it('responds to preceding content resizing without changing the saved scroll position', async () => {
    const view = render(<Fixture />);
    await flush();
    const scroller = screen.getByTestId('scroller');
    scroller.scrollTop = 720;
    fireEvent.scroll(scroller);
    await flush();
    view.rerender(<Fixture offset={360} />);
    await flush();
    expect(screen.getByTestId('row-10')).toBeInTheDocument();
    expect(scroller.scrollTop).toBe(720);
  });

  it('remounts the viewport after being hidden without resetting the scroll offset', async () => {
    render(<Fixture />);
    await flush();
    const scroller = screen.getByTestId('scroller');
    scroller.scrollTop = 720;
    viewportHeight = 0;
    fireEvent(window, new Event('resize'));
    await flush();
    expect(screen.queryAllByTestId(/^row-/)).toHaveLength(0);
    viewportHeight = 360;
    fireEvent(window, new Event('resize'));
    await flush();
    expect(screen.getByTestId('row-20')).toBeInTheDocument();
    expect(scroller.scrollTop).toBe(720);
  });

  it('handles an empty list and releases scroll listeners on unmount', async () => {
    const view = render(<Fixture count={0} />);
    await flush();
    expect(screen.queryAllByTestId(/^row-/)).toHaveLength(0);
    const scroller = screen.getByTestId('scroller');
    const remove = vi.spyOn(scroller, 'removeEventListener');
    view.unmount();
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
  });
});
