/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Resolve the development app name used to isolate local instances. */
export function getDevAppName(env: NodeJS.ProcessEnv = process.env): string {
  return env.AIONUI_MULTI_INSTANCE === '1' ? 'AionUi-Dev-2' : 'AionUi-Dev';
}
