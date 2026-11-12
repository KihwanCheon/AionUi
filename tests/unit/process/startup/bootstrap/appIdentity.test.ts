/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { configureAppIdentityEarly, type EarlyAppIdentityApi } from '@/process/startup/bootstrap/appIdentity';

function createAppApi(isPackaged = false) {
  const getPath = vi.fn(() => '/Users/Tester/Library/Application Support/Electron');
  const setName = vi.fn();
  const setPath = vi.fn();
  const appApi = { getPath, isPackaged, setName, setPath } as unknown as EarlyAppIdentityApi;
  return { appApi, getPath, setName, setPath };
}

describe('configureAppIdentityEarly', () => {
  it('isolates the default development instance before storage is read', () => {
    const { appApi, setName, setPath } = createAppApi();

    configureAppIdentityEarly({ appApi, env: {} });

    expect(setName).toHaveBeenCalledWith('AionUi-Dev');
    expect(setPath).toHaveBeenCalledWith('userData', '/Users/Tester/Library/Application Support/AionUi-Dev');
  });

  it('uses the isolated multi-instance development identity', () => {
    const { appApi, setName } = createAppApi();

    configureAppIdentityEarly({ appApi, env: { AIONUI_MULTI_INSTANCE: '1' } });

    expect(setName).toHaveBeenCalledWith('AionUi-Dev-2');
  });

  it('uses the explicit E2E directory without applying the development name', () => {
    const { appApi, setName, setPath } = createAppApi();
    const ensureDirectory = vi.fn();

    configureAppIdentityEarly({
      appApi,
      ensureDirectory,
      env: { AIONUI_E2E_TEST: '1', AIONUI_E2E_USER_DATA_DIR: ' C:\\Temp\\aionui-e2e ' },
    });

    expect(ensureDirectory).toHaveBeenCalledWith('C:\\Temp\\aionui-e2e');
    expect(setPath).toHaveBeenCalledWith('userData', 'C:\\Temp\\aionui-e2e');
    expect(setName).not.toHaveBeenCalled();
  });

  it('treats a blank E2E directory as missing instead of suppressing development isolation', () => {
    const { appApi, setName } = createAppApi();

    configureAppIdentityEarly({
      appApi,
      env: { AIONUI_E2E_TEST: '1', AIONUI_E2E_USER_DATA_DIR: '   ' },
    });

    expect(setName).toHaveBeenCalledWith('AionUi-Dev');
  });

  it('does not rewrite packaged application identity', () => {
    const { appApi, getPath, setName, setPath } = createAppApi(true);

    configureAppIdentityEarly({ appApi, env: {} });

    expect(getPath).not.toHaveBeenCalled();
    expect(setName).not.toHaveBeenCalled();
    expect(setPath).not.toHaveBeenCalled();
  });
});
