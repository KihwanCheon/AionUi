/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { useResizableSplit } from '@/renderer/hooks/ui/useResizableSplit';

const TABLET_MIN_VIEWPORT_PX = 768;
const TABLET_PANEL_MAX_RATIO = 0.85;
const TABLET_SIDER_MIN_PX = 260;
const TABLET_EXPLORER_MIN_PX = 280;
const TABLET_DEFAULT_MAX_PX = 420;
const TABLET_SIDER_DEFAULT_RATIO = 0.67;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const isResizableTabletLayout = (isMobile: boolean, viewportWidth: number): boolean =>
  isMobile && viewportWidth >= TABLET_MIN_VIEWPORT_PX;

export const useTabletPanelWidths = (isMobile: boolean, viewportWidth: number) => {
  const resizable = isResizableTabletLayout(isMobile, viewportWidth);
  const maxWidth = Math.max(TABLET_EXPLORER_MIN_PX, Math.round(viewportWidth * TABLET_PANEL_MAX_RATIO));
  const defaultSiderWidth = clamp(
    Math.round(viewportWidth * TABLET_SIDER_DEFAULT_RATIO),
    TABLET_SIDER_MIN_PX,
    TABLET_DEFAULT_MAX_PX
  );
  const defaultExplorerWidth = clamp(maxWidth, TABLET_EXPLORER_MIN_PX, TABLET_DEFAULT_MAX_PX);

  const {
    splitRatio: requestedSiderWidth,
    setSplitRatio: setSiderWidth,
    createDragHandle: createSiderDragHandle,
  } = useResizableSplit({
    unit: 'px',
    defaultWidth: defaultSiderWidth,
    minWidth: TABLET_SIDER_MIN_PX,
    maxWidth,
    storageKey: 'tablet-sider-width-px',
  });
  const {
    splitRatio: requestedExplorerWidth,
    setSplitRatio: setExplorerWidth,
    createDragHandle: createExplorerDragHandle,
  } = useResizableSplit({
    unit: 'px',
    defaultWidth: defaultExplorerWidth,
    minWidth: TABLET_EXPLORER_MIN_PX,
    maxWidth,
    storageKey: 'tablet-explorer-width-px',
  });

  useEffect(() => {
    if (!resizable) return;
    if (requestedSiderWidth > maxWidth) setSiderWidth(maxWidth);
    if (requestedExplorerWidth > maxWidth) setExplorerWidth(maxWidth);
  }, [maxWidth, requestedExplorerWidth, requestedSiderWidth, resizable, setExplorerWidth, setSiderWidth]);

  return {
    resizable,
    siderWidthPx: Math.min(requestedSiderWidth, maxWidth),
    explorerWidthPx: Math.min(requestedExplorerWidth, maxWidth),
    createSiderDragHandle,
    createExplorerDragHandle,
  };
};
