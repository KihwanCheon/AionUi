/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Render a small circular badge (red background, white count) to a PNG data URL,
 * used as the Windows taskbar overlay icon. Counts above 9 render as "9+".
 * Returns `undefined` when the count is non-positive or canvas is unavailable.
 */
export const renderTaskbarBadgeIcon = (count: number): string | undefined => {
  if (count <= 0 || typeof document === 'undefined') return undefined;

  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;

  const label = count > 9 ? '9+' : String(count);

  // Red circle background.
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.fillStyle = '#f53f3f';
  ctx.fill();

  // White count, scaled down a little for the two-character "9+".
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${label.length > 1 ? 18 : 22}px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, size / 2, size / 2 + 1);

  return canvas.toDataURL('image/png');
};
