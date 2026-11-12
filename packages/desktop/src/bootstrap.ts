/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import { createRequire } from 'node:module';
import { configureAppIdentityEarly } from './process/startup/bootstrap/appIdentity';
import {
  createBufferedEventRelay,
  findDeepLinkUrl,
  type AionUiBootstrapContext,
  type BootstrapProtocolEvent,
} from './process/startup/bootstrap/protocol';

type BootstrapGlobal = typeof globalThis & {
  __aionuiBootstrapContext?: AionUiBootstrapContext;
};

configureAppIdentityEarly();

const isE2ETestMode = process.env.AIONUI_E2E_TEST === '1';
const skipSingleInstanceLock = isE2ETestMode || process.env.AIONUI_MULTI_INSTANCE === '1';
const deepLinkFromArgv = findDeepLinkUrl(process.argv);
const gotTheLock = skipSingleInstanceLock
  ? true
  : app.requestSingleInstanceLock(deepLinkFromArgv ? { deepLinkUrl: deepLinkFromArgv } : {});

if (!gotTheLock) {
  app.exit(0);
} else {
  const protocolRelay = createBufferedEventRelay<BootstrapProtocolEvent>();
  const bootstrapContext: AionUiBootstrapContext = {
    attachProtocolHandler: protocolRelay.attach,
    ownsSingleInstanceLock: true,
  };
  (globalThis as BootstrapGlobal).__aionuiBootstrapContext = bootstrapContext;

  if (!skipSingleInstanceLock) {
    app.on('second-instance', (_event, argv, _workingDirectory, additionalData) => {
      const additionalDeepLink = (additionalData as { deepLinkUrl?: unknown })?.deepLinkUrl;
      protocolRelay.publish({
        kind: 'second-instance',
        deepLinkUrl: typeof additionalDeepLink === 'string' ? additionalDeepLink : findDeepLinkUrl(argv),
      });
    });
  }

  app.on('open-url', (event, url) => {
    event.preventDefault();
    protocolRelay.publish({ kind: 'open-url', deepLinkUrl: url });
  });

  try {
    // Keep the full application as a separate synchronous entry. Chromium
    // switches inside it must still run before Electron's first ready tick.
    createRequire(__filename)('./mainApplication.js');
  } catch (error) {
    process.stderr.write(`[AionUi] Failed to load the main application: ${String(error)}\n`);
    app.exit(1);
  }
}
