/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreviewTab } from '@/renderer/pages/conversation/Preview/context/PreviewContext';

const { browserViewerMock } = vi.hoisted(() => ({ browserViewerMock: vi.fn(() => null) }));

vi.mock('@/renderer/pages/conversation/Preview/browser/BrowserViewer', () => ({
  default: browserViewerMock,
}));

import BrowserTabLayer from '@/renderer/pages/conversation/Preview/browser/BrowserTabLayer';

const tabs: PreviewTab[] = [
  { id: 'first', content: 'https://first.example', content_type: 'browser', title: 'First' },
  { id: 'second', content: 'https://second.example', content_type: 'browser', title: 'Second' },
];

const activeByTab = (): Record<string, boolean> =>
  Object.fromEntries(
    browserViewerMock.mock.calls.map(([props]) => [
      (props as { tabId: string }).tabId,
      (props as { active: boolean }).active,
    ])
  );

afterEach(() => {
  cleanup();
  browserViewerMock.mockClear();
});

describe('BrowserTabLayer agent target selection', () => {
  it('marks only the visible browser tab active and updates it without remounting', () => {
    const { rerender } = render(<BrowserTabLayer browserTabs={tabs} activeTabId='first' updateTab={vi.fn()} />);

    expect(activeByTab()).toEqual({ first: true, second: false });

    browserViewerMock.mockClear();
    rerender(<BrowserTabLayer browserTabs={tabs} activeTabId='second' updateTab={vi.fn()} />);

    expect(activeByTab()).toEqual({ first: false, second: true });
  });

  it('marks every browser tab inactive while a non-browser preview is visible', () => {
    render(<BrowserTabLayer browserTabs={tabs} activeTabId='document-tab' updateTab={vi.fn()} />);

    expect(activeByTab()).toEqual({ first: false, second: false });
  });
});
