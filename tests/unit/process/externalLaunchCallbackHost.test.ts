/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Spec for handing aioncore the callback host of the paired MindNProgress
 * server. aioncore allow-lists external-launch callback targets (SSRF), and
 * loopback alone cannot express a sub machine whose paired server is remote.
 */

import { describe, expect, it } from 'vitest';

import {
  EXTERNAL_LAUNCH_CALLBACK_HOSTS_ENV,
  applyExternalLaunchCallbackHostEnv,
  pairedCallbackHost,
} from '@/process/startup/bootstrap/mindnprogressRunner/callbackHostEnv';

describe('pairedCallbackHost', () => {
  it('takes the hostname without port or path', () => {
    expect(pairedCallbackHost('http://192.0.2.1:4175')).toBe('192.0.2.1');
    expect(pairedCallbackHost('http://mnp.example.test:4175/')).toBe('mnp.example.test');
  });

  it('returns null when there is no pairing', () => {
    expect(pairedCallbackHost(null)).toBeNull();
    expect(pairedCallbackHost(undefined)).toBeNull();
    expect(pairedCallbackHost('')).toBeNull();
  });

  it('returns null for an unparseable url rather than passing junk to the backend', () => {
    expect(pairedCallbackHost('not a url')).toBeNull();
  });
});

describe('applyExternalLaunchCallbackHostEnv', () => {
  it('sets the host so the spawned backend inherits it', () => {
    const env: NodeJS.ProcessEnv = {};

    applyExternalLaunchCallbackHostEnv('http://192.0.2.1:4175', env);

    expect(env[EXTERNAL_LAUNCH_CALLBACK_HOSTS_ENV]).toBe('192.0.2.1');
  });

  it('clears a stale value when the pairing is gone', () => {
    const env: NodeJS.ProcessEnv = { [EXTERNAL_LAUNCH_CALLBACK_HOSTS_ENV]: '192.0.2.1' };

    applyExternalLaunchCallbackHostEnv(null, env);

    expect(env[EXTERNAL_LAUNCH_CALLBACK_HOSTS_ENV]).toBeUndefined();
  });

  it('clears rather than keeps a stale value when the url is unusable', () => {
    const env: NodeJS.ProcessEnv = { [EXTERNAL_LAUNCH_CALLBACK_HOSTS_ENV]: '192.0.2.1' };

    applyExternalLaunchCallbackHostEnv('nonsense', env);

    expect(env[EXTERNAL_LAUNCH_CALLBACK_HOSTS_ENV]).toBeUndefined();
  });
});
