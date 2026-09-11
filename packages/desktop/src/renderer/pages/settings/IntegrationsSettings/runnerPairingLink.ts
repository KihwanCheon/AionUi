/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Parse a MindNProgress Runner pairing link that the user pasted by hand.
 *
 * MindNProgress hands out pairing as an `aionui://mindnprogress/runner-pair`
 * deep link, and macOS routes that scheme to whichever bundle claims it in its
 * Info.plist. A dev build runs from Electron's own bundle, which claims
 * nothing, so the link never reaches it. Accepting the same link as pasted
 * text gives pairing a path that does not depend on the OS handler at all.
 *
 * The shape mirrors the deep-link branch in useDeepLink, so both entry points
 * feed the identical confirm-then-pair flow.
 */

import type { MindNProgressRunnerPairingDetail } from '@/renderer/hooks/system/useDeepLink';

const PAIRING_LINK_PREFIX = 'aionui://mindnprogress/runner-pair';

/**
 * A string discriminant, not a boolean one: this project compiles without
 * `strict`, and TypeScript will not narrow a union on a boolean literal
 * discriminant when `strictNullChecks` is off.
 *
 * `invalid-scheme`: not a runner-pair link at all.
 * `incomplete`: a runner-pair link that is missing one of the three fields.
 */
export type RunnerPairingLinkResult =
  | { status: 'ok'; detail: MindNProgressRunnerPairingDetail }
  | { status: 'invalid-scheme' }
  | { status: 'incomplete' };

function requiredParam(params: URLSearchParams, name: string): string {
  return (params.get(name) ?? '').trim();
}

export function parseRunnerPairingLink(raw: string): RunnerPairingLinkResult {
  const text = raw.trim();
  if (!text.startsWith(PAIRING_LINK_PREFIX)) return { status: 'invalid-scheme' };

  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { status: 'invalid-scheme' };
  }

  const apiUrl = requiredParam(parsed.searchParams, 'api_url');
  const pairingCode = requiredParam(parsed.searchParams, 'pairing_code');
  const machineId = requiredParam(parsed.searchParams, 'machine_id');
  if (!apiUrl || !pairingCode || !machineId) return { status: 'incomplete' };

  // The main process re-validates all three before contacting the server.
  return { status: 'ok', detail: { apiUrl, pairingCode, machineId } };
}
