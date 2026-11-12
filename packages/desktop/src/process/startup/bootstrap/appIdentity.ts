/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { getDevAppName } from '@/common/platform/devAppName';

export type EarlyAppIdentityApi = Pick<typeof app, 'getPath' | 'setName' | 'setPath'> & {
  readonly isPackaged: boolean;
};

type ConfigureAppIdentityOptions = {
  appApi?: EarlyAppIdentityApi;
  ensureDirectory?: (directory: string) => void;
  env?: NodeJS.ProcessEnv;
};

/**
 * Configure the app identity before requesting the single-instance lock.
 * Electron derives instance and storage state from these paths, so this is the
 * only filesystem setup allowed on the lock-losing bootstrap path.
 */
export function configureAppIdentityEarly(options: ConfigureAppIdentityOptions = {}): void {
  const appApi = options.appApi ?? app;
  const env = options.env ?? process.env;
  const ensureDirectory = options.ensureDirectory ?? ((directory: string) => mkdirSync(directory, { recursive: true }));
  const configuredE2EPath = env.AIONUI_E2E_TEST === '1' ? env.AIONUI_E2E_USER_DATA_DIR?.trim() : undefined;

  if (configuredE2EPath) {
    ensureDirectory(configuredE2EPath);
    appApi.setPath('userData', configuredE2EPath);
    return;
  }

  if (appApi.isPackaged) return;

  const devAppName = getDevAppName(env);
  appApi.setName(devAppName);
  const appSupportDir = path.dirname(appApi.getPath('userData'));
  appApi.setPath('userData', path.join(appSupportDir, devAppName));
}
