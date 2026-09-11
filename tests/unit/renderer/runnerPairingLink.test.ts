/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Spec for parsing a pasted MindNProgress Runner pairing link.
 *
 * The deep link is the only pairing entry point, and on a dev build macOS
 * routes aionui:// to whichever bundle claims the scheme — which is not the
 * dev Electron. Pasting the same link must reach the same confirm flow.
 */

import { describe, expect, it } from 'vitest';

import { parseRunnerPairingLink } from '@/renderer/pages/settings/IntegrationsSettings/runnerPairingLink';

const LINK =
  'aionui://mindnprogress/runner-pair?api_url=http%3A%2F%2F192.0.2.1%3A4175&pairing_code=mnppair_abcdefghijklmnopqrstuvwx&machine_id=macbook';

describe('parseRunnerPairingLink', () => {
  it('extracts the three pairing fields', () => {
    const result = parseRunnerPairingLink(LINK);

    expect(result).toEqual({
      status: 'ok',
      detail: {
        apiUrl: 'http://192.0.2.1:4175',
        pairingCode: 'mnppair_abcdefghijklmnopqrstuvwx',
        machineId: 'macbook',
      },
    });
  });

  it('tolerates surrounding whitespace from a copy-paste', () => {
    const result = parseRunnerPairingLink(`\n  ${LINK}  \n`);

    expect(result.status).toBe('ok');
  });

  it('rejects a link for a different aionui action', () => {
    expect(parseRunnerPairingLink('aionui://navigate?route=%2Fsettings')).toEqual({ status: 'invalid-scheme' });
  });

  it('rejects a non-aionui URL', () => {
    expect(parseRunnerPairingLink('https://192.0.2.1:4175/machines')).toEqual({ status: 'invalid-scheme' });
  });

  it('rejects unparseable text', () => {
    expect(parseRunnerPairingLink('페어링 링크를 붙여넣으세요')).toEqual({ status: 'invalid-scheme' });
    expect(parseRunnerPairingLink('')).toEqual({ status: 'invalid-scheme' });
  });

  it.each(['api_url', 'pairing_code', 'machine_id'])('reports an incomplete link missing %s', (missing) => {
    const url = new URL(LINK);
    url.searchParams.delete(missing);

    expect(parseRunnerPairingLink(url.toString())).toEqual({ status: 'incomplete' });
  });

  it('treats a blank parameter as incomplete', () => {
    const url = new URL(LINK);
    url.searchParams.set('machine_id', '   ');

    expect(parseRunnerPairingLink(url.toString())).toEqual({ status: 'incomplete' });
  });

  it('trims the extracted values', () => {
    const url = new URL(LINK);
    url.searchParams.set('machine_id', ' macbook ');
    const result = parseRunnerPairingLink(url.toString());

    expect(result.status === 'ok' && result.detail.machineId).toBe('macbook');
  });
});
