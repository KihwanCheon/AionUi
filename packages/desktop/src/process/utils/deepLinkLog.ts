/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Redacted one-line summary of a deep link, for the main-process log.
 *
 * Deep-link delivery has no observability today: an `aionui://` URL that the
 * OS routes to the wrong bundle, or one that arrives before the renderer is
 * ready, both look identical from outside — nothing happens and nothing is
 * logged. Logging the link lets those cases be told apart.
 *
 * Parameter VALUES are never emitted. A Runner pairing code is a one-time
 * credential, and the daily log file is what users attach to feedback reports.
 */

import { AIONUI_PROTOCOL_SCHEME } from '../startup/bootstrap/protocol';

export function describeDeepLinkForLog(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '<unparseable url>';
  }

  if (parsed.protocol !== `${AIONUI_PROTOCOL_SCHEME}:`) return '<non-aionui url>';

  const action = `${parsed.hostname}${parsed.pathname.replace(/\/+$/, '')}`;
  const names = [...parsed.searchParams.keys()].toSorted();
  return `${AIONUI_PROTOCOL_SCHEME}://${action} params=[${names.join(', ')}]`;
}
