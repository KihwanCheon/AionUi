/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Spec for the deep-link log summary.
 *
 * Deep links carry one-time secrets — a Runner pairing code is a credential —
 * and the daily log file is what users attach to feedback reports. The summary
 * must identify the link well enough to debug delivery while never emitting a
 * parameter value.
 */

import { describe, expect, it } from 'vitest';

import { describeDeepLinkForLog } from '@/process/utils/deepLinkLog';

const PAIRING_CODE = 'mnppair_abcdefghijklmnopqrstuvwx';

describe('describeDeepLinkForLog', () => {
  it('reports the action and parameter names', () => {
    const summary = describeDeepLinkForLog(
      `aionui://mindnprogress/runner-pair?api_url=http%3A%2F%2Fhost%3A4175&pairing_code=${PAIRING_CODE}&machine_id=macbook`
    );

    expect(summary).toBe('aionui://mindnprogress/runner-pair params=[api_url, machine_id, pairing_code]');
  });

  it('never emits a parameter value', () => {
    const summary = describeDeepLinkForLog(
      `aionui://mindnprogress/runner-pair?pairing_code=${PAIRING_CODE}&machine_id=macbook&api_url=http%3A%2F%2Fhost%3A4175`
    );

    expect(summary).not.toContain(PAIRING_CODE);
    expect(summary).not.toContain('macbook');
    expect(summary).not.toContain('host');
  });

  it('handles a link with no parameters', () => {
    expect(describeDeepLinkForLog('aionui://mindnprogress/runner-pair')).toBe(
      'aionui://mindnprogress/runner-pair params=[]'
    );
  });

  it('reports an action with no path segment', () => {
    expect(describeDeepLinkForLog('aionui://navigate?route=%2Fteam%2Fa')).toBe('aionui://navigate params=[route]');
  });

  it('does not leak the raw text of an unparseable link', () => {
    expect(describeDeepLinkForLog('not a url at all')).toBe('<unparseable url>');
  });

  it('marks a non-aionui scheme without echoing it', () => {
    expect(describeDeepLinkForLog('https://example.com/secret-path?token=abc')).toBe('<non-aionui url>');
  });
});
